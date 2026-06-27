import { createHash } from "crypto";

const DEFAULT_NODE_URL = "https://fullnode.mainnet.aptoslabs.com/v1";
const DEFAULT_SWITCHBOARD_ADDRESS =
  "0x7d7e436f0b2aafde60774efb26ccc432cf881b677aca7faaf2a01879bd19fb8";
const DEFAULT_QUEUE_ADDRESS =
  "0x11fbd91e4a718066891f37958f0b68d10e720f2edf8d57854fb20c299a119a8c";
const DEFAULT_CRANK_ADDRESS =
  "0xbc9576fedda51d33e8129b5f122ef4707c2079dfb11cd836e86adcb168cbd473";
const ORACLE_QUEUE_USAGE_PERMISSION_INDEX = 1;

type ScriptArgs = {
  nodeUrl: string;
  switchboardAddress: string;
  queueAddress: string;
  crankAddress: string;
};

type CrankRow = {
  aggregator_addr: string;
  timestamp: string;
};

type ClassifiedRow = {
  index: number;
  aggregatorAddr: string;
  timestamp: string;
  aggregatorQueueAddr: string | null;
  queueMatches: boolean;
  hasPermissionResource: boolean;
  hasUsagePermission: boolean;
  status:
    | "authorized"
    | "missing_permission"
    | "permission_denied"
    | "queue_mismatch"
    | "missing_aggregator";
};

function normalizeAddress(value: string): string {
  const hex = value.toLowerCase().replace(/^0x/, "");
  return `0x${hex.padStart(64, "0")}`;
}

function addressBytes(value: string): Buffer {
  return Buffer.from(normalizeAddress(value).slice(2), "hex");
}

function deriveResourceAddress(creator: string, seed: Buffer): string {
  return normalizeAddress(
    createHash("sha3-256")
      .update(addressBytes(creator))
      .update(seed)
      .update(Buffer.from([0xff]))
      .digest("hex")
  );
}

function derivePermissionKey(
  queueAuthority: string,
  queueAddress: string,
  aggregatorAddress: string
): string {
  const seed = Buffer.concat([
    Buffer.from("Permission", "utf8"),
    addressBytes(queueAddress),
    addressBytes(aggregatorAddress),
  ]);
  return deriveResourceAddress(queueAuthority, seed);
}

function parseArgs(argv: string[]): ScriptArgs {
  const args = {
    nodeUrl: DEFAULT_NODE_URL,
    switchboardAddress: DEFAULT_SWITCHBOARD_ADDRESS,
    queueAddress: DEFAULT_QUEUE_ADDRESS,
    crankAddress: DEFAULT_CRANK_ADDRESS,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value) {
      continue;
    }

    if (flag === "--node-url") {
      args.nodeUrl = value;
      i += 1;
    } else if (flag === "--switchboard") {
      args.switchboardAddress = value;
      i += 1;
    } else if (flag === "--queue") {
      args.queueAddress = value;
      i += 1;
    } else if (flag === "--crank") {
      args.crankAddress = value;
      i += 1;
    }
  }

  return {
    nodeUrl: args.nodeUrl,
    switchboardAddress: normalizeAddress(args.switchboardAddress),
    queueAddress: normalizeAddress(args.queueAddress),
    crankAddress: normalizeAddress(args.crankAddress),
  };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function getResourceOrNull<T>(
  nodeUrl: string,
  address: string,
  resourceType: string
): Promise<T | null> {
  try {
    return await getResource<T>(nodeUrl, address, resourceType);
  } catch {
    return null;
  }
}

async function getTableItemOrNull<T>(
  nodeUrl: string,
  handle: string,
  keyType: string,
  valueType: string,
  key: string
): Promise<T | null> {
  try {
    return await getJson<T>(`${nodeUrl}/tables/${handle}/item`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key_type: keyType,
        value_type: valueType,
        key,
      }),
    });
  } catch {
    return null;
  }
}

async function getResource<T>(
  nodeUrl: string,
  address: string,
  resourceType: string
): Promise<T> {
  return await getJson<T>(
    `${nodeUrl}/accounts/${address}/resource/${encodeURIComponent(resourceType)}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const stateType = `${args.switchboardAddress}::switchboard::State`;
  const crankType = `${args.switchboardAddress}::crank::Crank`;
  const queueConfigType = `${args.switchboardAddress}::oracle_queue::OracleQueueConfig`;
  const aggregatorConfigType =
    `${args.switchboardAddress}::aggregator::AggregatorConfig`;
  const permissionType = `${args.switchboardAddress}::permission::Permission`;

  const state = await getResource<any>(
    args.nodeUrl,
    args.switchboardAddress,
    stateType
  );
  const crank = await getResource<any>(args.nodeUrl, args.crankAddress, crankType);
  const queueAddress = normalizeAddress(args.queueAddress || crank.data.queue_addr);
  const queueConfig = await getResource<any>(
    args.nodeUrl,
    queueAddress,
    queueConfigType
  );

  const permissionHandle = state.data.permissions.handle as string;
  const queueAuthority = normalizeAddress(queueConfig.data.authority);
  const unpermissionedFeedsEnabled = !!queueConfig.data.unpermissioned_feeds_enabled;
  const heap = crank.data.heap as CrankRow[];

  const rows = await Promise.all(
    heap.map(async (row, index): Promise<ClassifiedRow> => {
      const aggregatorAddr = normalizeAddress(row.aggregator_addr);
      const aggregatorConfig = await getResourceOrNull<any>(
        args.nodeUrl,
        aggregatorAddr,
        aggregatorConfigType
      );

      if (!aggregatorConfig) {
        return {
          index,
          aggregatorAddr,
          timestamp: row.timestamp,
          aggregatorQueueAddr: null,
          queueMatches: false,
          hasPermissionResource: false,
          hasUsagePermission: false,
          status: "missing_aggregator",
        };
      }

      const aggregatorQueueAddr = normalizeAddress(aggregatorConfig.data.queue_addr);
      const queueMatches = aggregatorQueueAddr === queueAddress;
      if (!queueMatches) {
        return {
          index,
          aggregatorAddr,
          timestamp: row.timestamp,
          aggregatorQueueAddr,
          queueMatches,
          hasPermissionResource: false,
          hasUsagePermission: false,
          status: "queue_mismatch",
        };
      }

      if (unpermissionedFeedsEnabled) {
        return {
          index,
          aggregatorAddr,
          timestamp: row.timestamp,
          aggregatorQueueAddr,
          queueMatches,
          hasPermissionResource: false,
          hasUsagePermission: true,
          status: "authorized",
        };
      }

      const permissionKey = derivePermissionKey(
        queueAuthority,
        queueAddress,
        aggregatorAddr
      );
      const permission = await getTableItemOrNull<any>(
        args.nodeUrl,
        permissionHandle,
        "address",
        permissionType,
        permissionKey
      );

      if (!permission) {
        return {
          index,
          aggregatorAddr,
          timestamp: row.timestamp,
          aggregatorQueueAddr,
          queueMatches,
          hasPermissionResource: false,
          hasUsagePermission: false,
          status: "missing_permission",
        };
      }

      const bitField = (permission.permissions?.bit_field ?? []) as boolean[];
      const hasUsagePermission =
        bitField[ORACLE_QUEUE_USAGE_PERMISSION_INDEX] === true;

      return {
        index,
        aggregatorAddr,
        timestamp: row.timestamp,
        aggregatorQueueAddr,
        queueMatches,
        hasPermissionResource: true,
        hasUsagePermission,
        status: hasUsagePermission ? "authorized" : "permission_denied",
      };
    })
  );

  const unauthorizedRows = rows.filter((row) => row.status !== "authorized");
  const summary = {
    queueAddress,
    crankAddress: args.crankAddress,
    queueAuthority,
    unpermissionedFeedsEnabled,
    totalRows: rows.length,
    authorizedRows: rows.length - unauthorizedRows.length,
    unauthorizedRows: unauthorizedRows.length,
    badIndices: unauthorizedRows.map((row) => row.index),
  };

  console.log("Switchboard crank inspection");
  console.log(`node_url=${args.nodeUrl}`);
  console.log(`switchboard=${args.switchboardAddress}`);
  console.log(`queue=${summary.queueAddress}`);
  console.log(`crank=${summary.crankAddress}`);
  console.log(`queue_authority=${summary.queueAuthority}`);
  console.log(`unpermissioned_feeds_enabled=${summary.unpermissionedFeedsEnabled}`);
  console.log(`rows=${summary.totalRows}`);
  console.log(`authorized_rows=${summary.authorizedRows}`);
  console.log(`unauthorized_rows=${summary.unauthorizedRows}`);
  console.log(
    `bad_indices=${summary.badIndices.length > 0 ? summary.badIndices.join(",") : "(none)"}`
  );
  console.log("");

  for (const row of rows) {
    console.log(
      [
        `idx=${row.index}`,
        `status=${row.status}`,
        `aggregator=${row.aggregatorAddr}`,
        `timestamp=${row.timestamp}`,
        `permission_resource=${row.hasPermissionResource}`,
        `usage_permission=${row.hasUsagePermission}`,
      ].join(" ")
    );
  }

  console.log("");
  console.log(JSON.stringify({ summary, rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
