module switchboard::crank_pop_action {
    use aptos_framework::timestamp;
    use aptos_framework::account;
    use aptos_framework::aptos_coin::{Self, AptosCoin};
    use aptos_framework::block;
    use switchboard::aggregator;
    use switchboard::crank;
    use switchboard::crank_init_action;
    use switchboard::crank_push_action;
    use switchboard::errors;
    use switchboard::aggregator_open_round_action;
    use switchboard::lease_init_action;
    use switchboard::math;
    use switchboard::oracle_queue;
    use switchboard::oracle_queue_init_action;
    use switchboard::permission;
    use switchboard::permission_init_action;
    use switchboard::permission_set_action;
    use switchboard::switchboard;
    use switchboard::switchboard_init_action;
    use std::coin;
    use std::option;
    use std::signer;
    use std::vector;

    struct CrankPopParams has drop {
        crank_addr: address,
        pop_idx: u64,
    }

    public fun validate_and_actuate<CoinType>(account: &signer, params: &CrankPopParams) {

        // VALIDATE
        assert!(crank::exist(params.crank_addr), errors::CrankNotFound());
        let (
            aggregator_addr, 
            marked_allowed_timestamp,
            jitter_modifier,
        ) = crank::pop(params.crank_addr, params.pop_idx); // will abort if size == 0 
        assert!(timestamp::now_seconds() > marked_allowed_timestamp, errors::CrankNotReady());

        let open_round_params = aggregator_open_round_action::params(aggregator_addr, jitter_modifier);
        let (simulation_result, actuate_params) = aggregator_open_round_action::simulate<CoinType>(open_round_params);
        if (simulation_result == errors::PermissionDenied()) {
            let (
                _next_scheduled_timestamp,
                _reschedule,
            ) = aggregator::apply_open_round_simulate(aggregator_addr, simulation_result, jitter_modifier);
            switchboard::emit_aggregator_crank_eviction_event(
                params.crank_addr,
                aggregator_addr,
                simulation_result,
                timestamp::now_seconds()
            );
            return // no need to reschedule if not permitted
        };
        
        // ACTUATE
        let (
            next_scheduled_timestamp, 
            reschedule, 
        ) = aggregator::apply_open_round_simulate(aggregator_addr, simulation_result, jitter_modifier);
        
        if (simulation_result == errors::LeaseInsufficientCoin()) {
            switchboard::emit_crank_lease_insufficient_funds_event(aggregator_addr);
        };

        if (simulation_result == 0 && marked_allowed_timestamp == next_scheduled_timestamp) {
            next_scheduled_timestamp = aggregator_open_round_action::actuate<CoinType>(
                account, 
                option::extract(&mut actuate_params),
            );
        };

        if (reschedule) {
            crank::push(params.crank_addr, aggregator_addr, next_scheduled_timestamp);
        }
    }

    public entry fun run<CoinType>(account: signer, crank_addr: address, pop_idx: u64) {
        let params = CrankPopParams { crank_addr, pop_idx };
        validate_and_actuate<CoinType>(&account, &params); 
    }

    #[test_only]
    fun setup_legacy_bad_row(
        aptos_framework: &signer,
        queue_account: signer,
        queue_authority: &signer,
        crank_account: signer,
        aggregator_account: &signer,
    ) {
        let queue_addr = signer::address_of(&queue_account);
        let crank_addr = signer::address_of(&crank_account);
        let aggregator_addr = signer::address_of(aggregator_account);

        timestamp::set_time_has_started_for_testing(aptos_framework);
        timestamp::update_global_time_for_test_secs(10);
        account::create_account_for_test(@aptos_framework);
        block::initialize_for_test(aptos_framework, 1);

        switchboard_init_action::run(account::create_account_for_test(@switchboard));
        switchboard_init_action::add_switchboard_events(account::create_account_for_test(@switchboard));
        switchboard_init_action::add_switchboard_read_events(account::create_account_for_test(@switchboard));
        oracle_queue_init_action::run<AptosCoin>(
            queue_account,
            signer::address_of(queue_authority),
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
        crank_init_action::run<AptosCoin>(crank_account, queue_addr);

        aggregator::new_test(aggregator_account, 0, 0, false);
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

        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(aptos_framework);
        coin::register<AptosCoin>(aggregator_account);
        coin::deposit(aggregator_addr, coin::mint(10, &mint_cap));
        lease_init_action::run<AptosCoin>(
            aggregator_account,
            aggregator_addr,
            queue_addr,
            aggregator_addr,
            10,
        );
        coin::destroy_mint_cap(mint_cap);
        coin::destroy_burn_cap(burn_cap);

        permission_init_action::run(
            queue_authority,
            signer::address_of(queue_authority),
            queue_addr,
            aggregator_addr,
        );
        oracle_queue::push_back(queue_addr, @0x99);
        aggregator::add_crank_row_count(aggregator_addr);
        crank::push(crank_addr, aggregator_addr, 0);
    }

    #[test(
        aptos_framework = @0x1,
        _switchboard = @0x55,
        queue = @0x56,
        queue_authority = @0x57,
        crank = @0x58,
        aggregator = @0x59,
        keeper = @0x5A,
    )]
    fun test_permission_denied_pop_evicts_legacy_row(
        aptos_framework: signer,
        _switchboard: signer,
        queue: signer,
        queue_authority: signer,
        crank: signer,
        aggregator: signer,
        keeper: signer,
    ) {
        let crank_addr = signer::address_of(&crank);
        let aggregator_addr = signer::address_of(&aggregator);
        setup_legacy_bad_row(
            &aptos_framework,
            queue,
            &queue_authority,
            crank,
            &aggregator,
        );

        assert!(!aggregator_open_round_action::has_queue_usage_permission<AptosCoin>(aggregator_addr), 0);
        assert!(crank::size(crank_addr) == 1, 1);
        assert!(aggregator::crank_row_count(aggregator_addr) == 1, 2);
        assert!(switchboard::aggregator_crank_eviction_event_count() == 0, 3);

        run<AptosCoin>(keeper, crank_addr, 0);

        assert!(crank::size(crank_addr) == 0, 4);
        assert!(aggregator::crank_row_count(aggregator_addr) == 0, 5);
        assert!(switchboard::aggregator_crank_eviction_event_count() == 1, 6);
    }

    #[test(
        aptos_framework = @0x1,
        _switchboard = @0x55,
        queue = @0x56,
        queue_authority = @0x57,
        crank = @0x58,
        aggregator = @0x59,
        keeper = @0x5A,
    )]
    fun test_permissioned_feed_can_repush_after_cleanup(
        aptos_framework: signer,
        _switchboard: signer,
        queue: signer,
        queue_authority: signer,
        crank: signer,
        aggregator: signer,
        keeper: signer,
    ) {
        let queue_addr = signer::address_of(&queue);
        let crank_addr = signer::address_of(&crank);
        let aggregator_addr = signer::address_of(&aggregator);
        setup_legacy_bad_row(
            &aptos_framework,
            queue,
            &queue_authority,
            crank,
            &aggregator,
        );

        run<AptosCoin>(keeper, crank_addr, 0);
        permission_set_action::run(
            &queue_authority,
            signer::address_of(&queue_authority),
            queue_addr,
            aggregator_addr,
            permission::PERMIT_ORACLE_QUEUE_USAGE(),
            true,
        );
        crank_push_action::run<AptosCoin>(&aggregator, crank_addr, aggregator_addr);

        assert!(aggregator_open_round_action::has_queue_usage_permission<AptosCoin>(aggregator_addr), 7);
        assert!(aggregator::crank_row_count(aggregator_addr) == 1, 8);
        assert!(crank::size(crank_addr) == 1, 9);
    }

}
