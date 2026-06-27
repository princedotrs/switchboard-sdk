module switchboard::create_feed_action {
    use switchboard::aggregator;
    use switchboard::aggregator_init_action;
    use switchboard::aggregator_add_job_action;
    use switchboard::aggregator_open_round_action;
    use switchboard::crank;
    use switchboard::crank_init_action;
    use switchboard::job_init_action;
    use switchboard::lease_init_action;
    use switchboard::crank_push_action;
    use switchboard::oracle_queue;
    use switchboard::oracle_queue_init_action;
    use switchboard::permission_init_action;
    use switchboard::permission_set_action;
    use switchboard::permission;
    use switchboard::switchboard_init_action;
    use aptos_framework::account;
    use aptos_framework::aptos_coin::{Self, AptosCoin};
    use aptos_framework::block;
    use aptos_framework::timestamp;
    use std::coin;
    use std::signer;
    use std::vector;
    use std::bcs;

    public entry fun run<CoinType>(
        account: signer,
        authority: address,

        // Aggregator
        name: vector<u8>,
        metadata: vector<u8>,
        queue_addr: address,
        batch_size: u64,
        min_oracle_results: u64,
        min_job_results: u64,
        min_update_delay_seconds: u64,
        start_after: u64,
        variance_threshold_value: u128, 
        variance_threshold_scale: u8, 
        force_report_period: u64,
        expiration: u64,
        disable_crank: bool,
        history_size: u64,
        read_charge: u64,
        reward_escrow: address,
        read_whitelist: vector<address>,
        limit_reads_to_whitelist: bool,

        // Lease
        load_amount: u64,

        // Job 1 
        job_1_name: vector<u8>,
        job_1_metadata: vector<u8>,
        job_1_data: vector<u8>,
        job_1_weight: u8,


        // Job 2
        job_2_name: vector<u8>,
        job_2_metadata: vector<u8>,
        job_2_data: vector<u8>,
        job_2_weight: u8, 


        // Job 3
        job_3_name: vector<u8>,
        job_3_metadata: vector<u8>,
        job_3_data: vector<u8>,
        job_3_weight: u8,


        // Job 4
        job_4_name: vector<u8>,
        job_4_metadata: vector<u8>,
        job_4_data: vector<u8>,
        job_4_weight: u8, 

        // Job 5
        job_5_name: vector<u8>,
        job_5_metadata: vector<u8>,
        job_5_data: vector<u8>,
        job_5_weight: u8,

        // Job 6
        job_6_name: vector<u8>,
        job_6_metadata: vector<u8>,
        job_6_data: vector<u8>,
        job_6_weight: u8,

         // Job 7
        job_7_name: vector<u8>,
        job_7_metadata: vector<u8>,
        job_7_data: vector<u8>,
        job_7_weight: u8,

        // Job 8
        job_8_name: vector<u8>,
        job_8_metadata: vector<u8>,
        job_8_data: vector<u8>,
        job_8_weight: u8,

        // Crank Push
        crank_addr: address,

        // Seed 
        seed: address,
    ) {

        let bcs_seed = bcs::to_bytes(&seed);

        let aggregator_addr = account::create_resource_address(&signer::address_of(&account), copy bcs_seed);

        // Initialize Aggregator
        aggregator_init_action::run<CoinType>(
            &account,
            name,
            metadata,
            queue_addr,
            crank_addr,
            batch_size,
            min_oracle_results,
            min_job_results,
            min_update_delay_seconds,
            start_after,
            variance_threshold_value,
            variance_threshold_scale,
            force_report_period,
            expiration,
            disable_crank,
            history_size,
            read_charge,
            reward_escrow,
            read_whitelist,
            limit_reads_to_whitelist,
            authority,
            seed,
        );

        // Initialize Lease for Aggregator
        lease_init_action::run<CoinType>(
            &account,
            aggregator_addr,
            queue_addr, 
            authority, 
            load_amount,
        );

        // Create and Add Jobs (if they exist)
        if (vector::length<u8>(&job_1_data) > 0) {

            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 1);
            
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_1_name,
                job_1_metadata,
                authority,
                job_1_data
            );

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_1_weight,
            );
        };

        if (vector::length<u8>(&job_2_data) > 0) {

            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 2);
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_2_name,
                job_2_metadata,
                authority,
                job_2_data
            );

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_2_weight,
            );
        };

        if (vector::length<u8>(&job_3_data) > 0) {

            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 3);
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_3_name,
                job_3_metadata,
                authority,
                job_3_data
            );

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_3_weight,
            );
        };

        if (vector::length<u8>(&job_4_data) > 0) {

            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 4);
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_4_name,
                job_4_metadata,
                authority,
                job_4_data
            );

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_4_weight,
            );
        };

        if (vector::length<u8>(&job_5_data) > 0) {

            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 5);
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_5_name,
                job_5_metadata,
                authority,
                job_5_data
            );   

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_5_weight,
            );
        };

        if (vector::length<u8>(&job_6_data) > 0) {

            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 6);
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_6_name,
                job_6_metadata,
                authority,
                job_6_data
            );

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_6_weight,
            ); 
        };

        if (vector::length<u8>(&job_7_data) > 0) {

            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 7);
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_7_name,
                job_7_metadata,
                authority,
                job_7_data
            );   

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_7_weight,
            );
        };

        if (vector::length<u8>(&job_8_data) > 0) {
            
            let job_seed = copy bcs_seed;
            vector::push_back(&mut job_seed, 8);
            let (resource, _signer_cap) = account::create_resource_account(&account, job_seed);
            job_init_action::run(
                &resource,
                job_8_name,
                job_8_metadata,
                authority,
                job_8_data
            );

            aggregator_add_job_action::run(
                &account,
                aggregator_addr,
                signer::address_of(&resource), 
                job_8_weight,
            ); 
        };

        // get the authority from queue_addr
        let queue_authority = oracle_queue::authority<CoinType>(queue_addr);

        // create permission
        permission_init_action::run(
            &account,
            queue_authority,
            queue_addr,
            aggregator_addr,
        );

        // allow heartbeat permission
        if (queue_authority == signer::address_of(&account)) {
            permission_set_action::run(
                &account,
                queue_authority,
                queue_addr,
                aggregator_addr,
                permission::PERMIT_ORACLE_QUEUE_USAGE(),
                true,
            );
        };

        if (!disable_crank && aggregator_open_round_action::has_queue_usage_permission<CoinType>(aggregator_addr)) {
            crank_push_action::run<CoinType>(
                &account,
                crank_addr, 
                aggregator_addr,
            );
        }
    }

    #[test_only]
    fun setup_permissioned_queue<CoinType>(
        queue_account: signer,
        queue_authority: address,
        crank_account: signer,
    ) {
        let queue_addr = signer::address_of(&queue_account);
        switchboard_init_action::run(account::create_account_for_test(@switchboard));
        switchboard_init_action::add_switchboard_events(account::create_account_for_test(@switchboard));
        switchboard_init_action::add_switchboard_read_events(account::create_account_for_test(@switchboard));
        oracle_queue_init_action::run<CoinType>(
            queue_account,
            queue_authority,
            b"Permissioned Queue",
            b"",
            60,
            1,
            0,
            false,
            1,
            0,
            0,
            0,
            0,
            false,
            false,
            false,
            false,
            32,
            0,
            0,
            0,
            0,
        );
        crank_init_action::run<CoinType>(crank_account, queue_addr);
    }

    #[test_only]
    fun run_default_feed<CoinType>(
        account: signer,
        authority: address,
        queue_addr: address,
        crank_addr: address,
        load_amount: u64,
        seed: address,
    ) {
        run<CoinType>(
            account,
            authority,
            b"Feed",
            b"",
            queue_addr,
            1,
            1,
            1,
            5,
            0,
            0,
            0,
            0,
            0,
            false,
            0,
            0,
            @switchboard,
            vector::empty<address>(),
            false,
            load_amount,
            b"",
            b"",
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            crank_addr,
            seed,
        );
    }

    #[test(
        aptos_framework = @0x1,
        _switchboard = @0x55,
        queue = @0x56,
        queue_authority = @0x57,
        crank = @0x58,
        creator = @0x59,
    )]
    fun test_create_feed_without_usage_permission_stays_off_crank(
        aptos_framework: signer,
        _switchboard: signer,
        queue: signer,
        queue_authority: signer,
        crank: signer,
        creator: signer,
    ) {
        timestamp::set_time_has_started_for_testing(&aptos_framework);
        timestamp::update_global_time_for_test_secs(10);
        account::create_account_for_test(@aptos_framework);
        block::initialize_for_test(&aptos_framework, 1);

        let queue_addr = signer::address_of(&queue);
        let crank_addr = signer::address_of(&crank);
        let creator_addr = signer::address_of(&creator);
        let seed = @0xC0DE;
        let feed_addr = account::create_resource_address(&creator_addr, bcs::to_bytes(&seed));

        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(&aptos_framework);
        coin::register<AptosCoin>(&creator);
        coin::deposit(creator_addr, coin::mint(10, &mint_cap));

        setup_permissioned_queue<AptosCoin>(queue, signer::address_of(&queue_authority), crank);
        run_default_feed<AptosCoin>(creator, creator_addr, queue_addr, crank_addr, 10, seed);

        assert!(aggregator::exist(feed_addr), 0);
        assert!(!aggregator_open_round_action::has_queue_usage_permission<AptosCoin>(feed_addr), 1);
        assert!(aggregator::test_crank_row_count(feed_addr) == 0, 2);
        assert!(crank::test_size(crank_addr) == 0, 3);

        coin::destroy_mint_cap(mint_cap);
        coin::destroy_burn_cap(burn_cap);
    }

    #[test(
        aptos_framework = @0x1,
        _switchboard = @0x55,
        queue = @0x56,
        queue_authority = @0x57,
        crank = @0x58,
    )]
    fun test_create_feed_with_usage_permission_auto_pushes(
        aptos_framework: signer,
        _switchboard: signer,
        queue: signer,
        queue_authority: signer,
        crank: signer,
    ) {
        timestamp::set_time_has_started_for_testing(&aptos_framework);
        timestamp::update_global_time_for_test_secs(10);
        account::create_account_for_test(@aptos_framework);
        block::initialize_for_test(&aptos_framework, 1);

        let queue_addr = signer::address_of(&queue);
        let crank_addr = signer::address_of(&crank);
        let creator_addr = signer::address_of(&queue_authority);
        let seed = @0xBEEF;
        let feed_addr = account::create_resource_address(&creator_addr, bcs::to_bytes(&seed));

        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(&aptos_framework);
        coin::register<AptosCoin>(&queue_authority);
        coin::deposit(creator_addr, coin::mint(10, &mint_cap));

        setup_permissioned_queue<AptosCoin>(queue, creator_addr, crank);
        run_default_feed<AptosCoin>(queue_authority, creator_addr, queue_addr, crank_addr, 10, seed);

        assert!(aggregator::exist(feed_addr), 4);
        assert!(aggregator_open_round_action::has_queue_usage_permission<AptosCoin>(feed_addr), 5);
        assert!(aggregator::test_crank_row_count(feed_addr) == 1, 6);
        assert!(crank::test_size(crank_addr) == 1, 7);

        coin::destroy_mint_cap(mint_cap);
        coin::destroy_burn_cap(burn_cap);
    }
}
