import { OracleJob } from "../src/index.js";

import { expect } from "chai";

const yaml = `
tasks:
  - httpTask:
      url: https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT
  - medianTask:
      tasks:
        - jsonParseTask:
            path: $.bid
        - jsonParseTask:
            path: $.ask
        - jsonParseTask:
            path: $.last
`.trim();

const json = {
  tasks: [
    {
      httpTask: {
        url: "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT",
      },
    },
    {
      medianTask: {
        tasks: [
          { jsonParseTask: { path: "$.bid" } },
          { jsonParseTask: { path: "$.ask" } },
          { jsonParseTask: { path: "$.last" } },
        ],
      },
    },
  ],
};
const oracleJob = OracleJob.create(json);

describe("OracleJob Tests", () => {
  describe("JSON", () => {
    it("OracleJob.toJSON", () => {
      expect(oracleJob.toJSON()).deep.equal(json);
    });

    it("round trips upgraded Pyth push-feed fields", () => {
      const pythPushFeedId =
        "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
      const pushFeedJob = OracleJob.create({
        tasks: [
          {
            oracleTask: {
              pythPushFeedId,
              pythConfigs: {
                pushFeedShardId: 0,
                maxStaleSeconds: 75,
              },
            },
          },
        ],
      });

      expect(pushFeedJob.toJSON()).deep.equal({
        tasks: [
          {
            oracleTask: {
              pythPushFeedId,
              pythConfigs: {
                pushFeedShardId: 0,
                maxStaleSeconds: 75,
              },
            },
          },
        ],
      });
    });

    it("round trips a Pyth Hermes API key placeholder", () => {
      const pythAddress = "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG";
      const pythHermesJob = OracleJob.create({
        tasks: [
          {
            oracleTask: {
              pythAddress,
              pythConfigs: {
                apiKey: "${PYTH_API_KEY}",
              },
            },
          },
        ],
      });

      expect(pythHermesJob.toJSON()).deep.equal({
        tasks: [
          {
            oracleTask: {
              pythAddress,
              pythConfigs: {
                apiKey: "${PYTH_API_KEY}",
              },
            },
          },
        ],
      });
    });
  });
  describe("YAML", () => {
    it("OracleJob.toYaml", () => {
      expect(oracleJob.toYaml().trim()).deep.equal(yaml);
    });

    it("OracleJob.fromYaml", () => {
      expect(OracleJob.fromYaml(yaml).toJSON()).deep.equal(json);
    });

    it("Accesses child properties", () => {
      const bufferParserType = (iTask: OracleJob) => {};

      expect(bufferParserType).not.throw();
    });
  });
});
