module switchboard::crank_push_action {
    use aptos_framework::timestamp;
    use aptos_framework::account;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::block;
    use switchboard::aggregator;
    use switchboard::aggregator_open_round_action;
    use switchboard::crank;
    use switchboard::crank_init_action;
    use switchboard::errors;
    use switchboard::math;
    use switchboard::oracle_queue_init_action;
    use switchboard::switchboard_init_action;
    use std::signer;
    use std::vector;

    struct CrankPushParams has drop {
        crank_addr: address,
        aggregator_addr: address,
    }

    public fun validate<CoinType>(_account: &signer, params: &CrankPushParams) {
        assert!(crank::exist(params.crank_addr), errors::CrankNotFound());
        assert!(aggregator::exist(params.aggregator_addr), errors::AggregatorNotFound());
        assert!(!aggregator::crank_disabled(params.aggregator_addr), errors::CrankDisabled());
        assert!(aggregator::crank_row_count(params.aggregator_addr) == 0, errors::PermissionDenied());
        assert!(aggregator_open_round_action::has_queue_usage_permission<CoinType>(params.aggregator_addr), errors::PermissionDenied());
    }

    fun actuate(account: &signer, params: &CrankPushParams) {
        aggregator::add_crank_row_count(params.aggregator_addr);

        // only the aggregator authority can set the crank 
        if (aggregator::has_authority(params.aggregator_addr, account)) {
            aggregator::set_crank(params.aggregator_addr, params.crank_addr);
        };

        // anybody can re-push, but they have to explicitly list the crank_addr
        assert!(aggregator::crank_addr(params.aggregator_addr) == params.crank_addr, errors::InvalidArgument());
        crank::push(aggregator::crank_addr(params.aggregator_addr), params.aggregator_addr, timestamp::now_seconds());
    }


    public entry fun run<CoinType>(account: &signer, crank_addr: address, aggregator_addr: address) {
        let params = CrankPushParams { 
            crank_addr,
            aggregator_addr
        };
        
        // enforce that aggregator is on this crank
        validate<CoinType>(account, &params);
        actuate(account, &params);
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

    #[test(
        aptos_framework = @0x1,
        _switchboard = @0x55,
        queue = @0x56,
        queue_authority = @0x57,
        crank = @0x58,
        aggregator = @0x59,
    )]
    #[expected_failure(abort_code = 327698, location = switchboard::crank_push_action)]
    fun test_permissioned_queue_rejects_unauthorized_push(
        aptos_framework: signer,
        _switchboard: signer,
        queue: signer,
        queue_authority: signer,
        crank: signer,
        aggregator: signer,
    ) {
        timestamp::set_time_has_started_for_testing(&aptos_framework);
        timestamp::update_global_time_for_test_secs(10);
        account::create_account_for_test(@aptos_framework);
        block::initialize_for_test(&aptos_framework, 1);

        let queue_addr = signer::address_of(&queue);
        let crank_addr = signer::address_of(&crank);
        let aggregator_addr = signer::address_of(&aggregator);
        setup_permissioned_queue<AptosCoin>(queue, signer::address_of(&queue_authority), crank);

        aggregator::new_test(&aggregator, 0, 0, false);
        let config = aggregator::new_config(
            aggregator_addr,
            b"Aggregator",
            b"",
            queue_addr,
            crank_addr,
            1,
            1,
            1,
            5,
            0,
            math::zero(),
            0,
            0,
            false,
            0,
            0,
            @switchboard,
            vector::empty<address>(),
            false,
            aggregator_addr,
        );
        aggregator::set_config(&config);

        assert!(!aggregator_open_round_action::has_queue_usage_permission<AptosCoin>(aggregator_addr), 0);
        assert!(aggregator::crank_row_count(aggregator_addr) == 0, 1);
        assert!(crank::size(crank_addr) == 0, 2);

        run<AptosCoin>(&aggregator, crank_addr, aggregator_addr);
    }

}
