// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {PoolAddressesProvider} from "@aave/core-v3/contracts/protocol/configuration/PoolAddressesProvider.sol";
import {ACLManager} from "@aave/core-v3/contracts/protocol/configuration/ACLManager.sol";
import {Pool} from "@aave/core-v3/contracts/protocol/pool/Pool.sol";
import {PoolConfigurator} from "@aave/core-v3/contracts/protocol/pool/PoolConfigurator.sol";
import {DefaultReserveInterestRateStrategy} from "@aave/core-v3/contracts/protocol/pool/DefaultReserveInterestRateStrategy.sol";
import {AaveOracle} from "@aave/core-v3/contracts/misc/AaveOracle.sol";
import {AaveProtocolDataProvider} from "@aave/core-v3/contracts/misc/AaveProtocolDataProvider.sol";
import {AToken} from "@aave/core-v3/contracts/protocol/tokenization/AToken.sol";
import {StableDebtToken} from "@aave/core-v3/contracts/protocol/tokenization/StableDebtToken.sol";
import {VariableDebtToken} from "@aave/core-v3/contracts/protocol/tokenization/VariableDebtToken.sol";
import {MintableERC20} from "@aave/core-v3/contracts/mocks/tokens/MintableERC20.sol";
import {ConfiguratorInputTypes} from "@aave/core-v3/contracts/protocol/libraries/types/ConfiguratorInputTypes.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IPoolConfigurator} from "@aave/core-v3/contracts/interfaces/IPoolConfigurator.sol";

import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";

/// @notice Deploys a local Aave V3 instance and lists reserves that mirror
/// the `ASSETS` table in src/App.jsx exactly (ticker, price, maxLTV,
/// liqThreshold) — the front end's simulated numbers and this deployment's
/// on-chain parameters must never drift apart.
///
/// Every stock/ETF reserve is listed as collateral-only (borrowing disabled);
/// USDG is the only borrowable asset. This matches Parapet's "post stocks,
/// borrow USDG" positioning and is what gives the front end's single
/// cross-asset health factor (computePosition() in App.jsx) real on-chain
/// meaning — Aave aggregates collateral/debt across every reserve a user
/// holds into one account-level health factor natively.
///
/// Shared by ConfigureReserves.s.sol (real script, broadcasts) and
/// CrossCollateralHealthFactor.t.sol (test, deploys directly) so the market
/// definition lives in exactly one place.
abstract contract ParapetMarketDeployer {
    struct AssetSeed {
        string ticker;
        string name;
        int256 price8; // Chainlink-style, 8 decimals
        uint256 ltvBps; // basis points, matches App.jsx maxLTV * 10000
        uint256 liqThresholdBps; // basis points, matches App.jsx liqThreshold * 10000
        bool borrowable;
    }

    // Mirrors ASSETS in src/App.jsx:36-46. USDG has ltv/liqThreshold 0 there
    // too — computePosition() only counts an asset as collateral when
    // maxLTV > 0, which is exactly how Aave's borrowingEnabled/collateral
    // config is split here.
    uint256 private constant NUM_ASSETS = 9;

    function _assetSeeds() internal pure returns (AssetSeed[NUM_ASSETS] memory seeds) {
        seeds[0] = AssetSeed("USDG", "Global Dollar", 1_00000000, 0, 0, true);
        seeds[1] = AssetSeed("SPY", "S&P 500 ETF", 659_40000000, 7800, 8400, false);
        seeds[2] = AssetSeed("AAPL", "Apple", 231_50000000, 6800, 7500, false);
        seeds[3] = AssetSeed("MSFT", "Microsoft", 478_60000000, 7000, 7700, false);
        seeds[4] = AssetSeed("NVDA", "NVIDIA", 184_20000000, 6000, 6800, false);
        seeds[5] = AssetSeed("GOOGL", "Alphabet", 206_40000000, 6800, 7500, false);
        seeds[6] = AssetSeed("AMZN", "Amazon", 224_10000000, 6500, 7200, false);
        seeds[7] = AssetSeed("TSLA", "Tesla", 341_20000000, 5500, 6300, false);
        seeds[8] = AssetSeed("JNJ", "Johnson & Johnson", 164_90000000, 7400, 8000, false);
    }

    // Flat 8% liquidation bonus for every collateral asset. Not something
    // App.jsx models (the front end only shows LTV/liqThreshold) — this is a
    // new, real-money parameter that has to exist on-chain. 8% is safely
    // inside Aave's validity bound for every seed above (liqThreshold *
    // bonus <= 100%; the tightest case is SPY at 84% threshold, which allows
    // up to ~19%).
    uint256 private constant LIQUIDATION_BONUS_BPS = 10800;

    PoolAddressesProvider public provider;
    ACLManager public aclManager;
    IPool public pool;
    IPoolConfigurator public configurator;
    AaveOracle public oracle;
    AaveProtocolDataProvider public dataProvider;

    mapping(string => address) public tokenOf;
    mapping(string => address) public priceFeedOf;

    function _deployMarket(address admin) internal {
        provider = new PoolAddressesProvider("Parapet", admin);
        provider.setACLAdmin(admin);
        aclManager = new ACLManager(provider);
        provider.setACLManager(address(aclManager));
        aclManager.addPoolAdmin(admin);
        aclManager.addRiskAdmin(admin);
        aclManager.addAssetListingAdmin(admin);

        Pool poolImpl = new Pool(provider);
        provider.setPoolImpl(address(poolImpl));
        pool = IPool(provider.getPool());

        PoolConfigurator configuratorImpl = new PoolConfigurator();
        provider.setPoolConfiguratorImpl(address(configuratorImpl));
        configurator = IPoolConfigurator(provider.getPoolConfigurator());

        oracle = new AaveOracle(provider, new address[](0), new address[](0), address(0), address(0), 1e8);
        provider.setPriceOracle(address(oracle));

        dataProvider = new AaveProtocolDataProvider(provider);
        provider.setPoolDataProvider(address(dataProvider));

        AToken aTokenImpl = new AToken(pool);
        StableDebtToken stableDebtImpl = new StableDebtToken(pool);
        VariableDebtToken variableDebtImpl = new VariableDebtToken(pool);

        // Zero-rate curve for collateral-only reserves: they can't be
        // borrowed, so utilization is always 0 and this strategy is never
        // meaningfully exercised. USDG gets a real utilization-reactive
        // curve since it's the only asset anyone actually borrows.
        DefaultReserveInterestRateStrategy zeroRateStrategy = new DefaultReserveInterestRateStrategy(
            provider, 0.8e27, 0, 0, 0, 0, 0, 0, 0, 0
        );
        DefaultReserveInterestRateStrategy usdgRateStrategy = new DefaultReserveInterestRateStrategy(
            provider, 0.8e27, 0, 0.04e27, 0.6e27, 0, 0, 0, 0, 0
        );

        AssetSeed[NUM_ASSETS] memory seeds = _assetSeeds();
        address[] memory assets = new address[](NUM_ASSETS);
        address[] memory sources = new address[](NUM_ASSETS);
        ConfiguratorInputTypes.InitReserveInput[] memory inputs =
            new ConfiguratorInputTypes.InitReserveInput[](NUM_ASSETS);

        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            AssetSeed memory seed = seeds[i];

            MintableERC20 token = new MintableERC20(seed.name, seed.ticker, 18);
            MockPriceFeed feed = new MockPriceFeed(seed.price8);
            tokenOf[seed.ticker] = address(token);
            priceFeedOf[seed.ticker] = address(feed);
            assets[i] = address(token);
            sources[i] = address(feed);

            inputs[i] = ConfiguratorInputTypes.InitReserveInput({
                aTokenImpl: address(aTokenImpl),
                stableDebtTokenImpl: address(stableDebtImpl),
                variableDebtTokenImpl: address(variableDebtImpl),
                underlyingAssetDecimals: 18,
                interestRateStrategyAddress: address(seed.borrowable ? usdgRateStrategy : zeroRateStrategy),
                underlyingAsset: address(token),
                treasury: admin,
                incentivesController: address(0),
                aTokenName: string.concat("Parapet ", seed.name),
                aTokenSymbol: string.concat("p", seed.ticker),
                variableDebtTokenName: string.concat("Parapet Variable Debt ", seed.name),
                variableDebtTokenSymbol: string.concat("vd", seed.ticker),
                stableDebtTokenName: string.concat("Parapet Stable Debt ", seed.name),
                stableDebtTokenSymbol: string.concat("sd", seed.ticker),
                params: bytes("")
            });
        }

        oracle.setAssetSources(assets, sources);
        configurator.initReserves(inputs);

        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            AssetSeed memory seed = seeds[i];
            address asset = tokenOf[seed.ticker];

            if (seed.liqThresholdBps > 0) {
                configurator.configureReserveAsCollateral(asset, seed.ltvBps, seed.liqThresholdBps, LIQUIDATION_BONUS_BPS);
            }
            if (seed.borrowable) {
                configurator.setReserveBorrowing(asset, true);
                configurator.setReserveFactor(asset, 1000); // 10% protocol reserve factor on USDG interest
            }
        }
    }
}
