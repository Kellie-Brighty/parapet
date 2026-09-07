// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Script, console2} from "forge-std/Script.sol";
import {ParapetMarketDeployer} from "./ParapetMarketDeployer.sol";

/// @notice Local/devnet deployment: stands up an Aave V3 instance and lists
/// reserves matching src/App.jsx's ASSETS table. Not wired to any real
/// chain yet — run against a local anvil node while the contracts layer is
/// still being built and reviewed.
///
///   anvil                                   # in one terminal
///   forge script script/ConfigureReserves.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow
///
/// --slow is required: this script fires ~50 sequential deployments/config
/// calls, and without it forge submits them faster than anvil settles
/// nonces, which leaves later transactions permanently pending.
contract ConfigureReserves is Script, ParapetMarketDeployer {
    function run() external {
        address admin = msg.sender;
        vm.startBroadcast();
        _deployMarket(admin);
        vm.stopBroadcast();

        console2.log("PoolAddressesProvider:", address(provider));
        console2.log("Pool:", address(pool));
        console2.log("PoolConfigurator:", address(configurator));
        console2.log("AaveOracle:", address(oracle));
        console2.log("AaveProtocolDataProvider:", address(dataProvider));
        console2.log("USDG:", tokenOf["USDG"]);
        console2.log("NVDA:", tokenOf["NVDA"]);
        console2.log("AAPL:", tokenOf["AAPL"]);
    }
}
