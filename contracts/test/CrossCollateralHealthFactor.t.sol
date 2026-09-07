// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Test} from "forge-std/Test.sol";
import {ParapetMarketDeployer} from "../script/ParapetMarketDeployer.sol";
import {MintableERC20} from "@aave/core-v3/contracts/mocks/tokens/MintableERC20.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";

/// @notice Verifies the on-chain, cross-collateral health factor Aave
/// computes natively matches the math the front end already promises in
/// computePosition() (src/App.jsx:75-106) — same formula, same numbers,
/// two different places. Also checks the two things that make this a
/// "post stocks, borrow USDG" market rather than a general money market:
/// collateral-only reserves reject borrows, and a price crash below the
/// liquidation threshold makes a position liquidatable.
contract CrossCollateralHealthFactorTest is Test, ParapetMarketDeployer {
    address internal liquidityProvider = makeAddr("liquidityProvider");
    address internal borrower = makeAddr("borrower");
    address internal liquidator = makeAddr("liquidator");

    function setUp() public {
        _deployMarket(address(this));

        // Seed the USDG reserve with liquidity, the way real depositors would.
        _mintAndSupply("USDG", liquidityProvider, 1_000_000e18);
    }

    function test_CrossCollateralHealthFactorMatchesFrontendMath() public {
        // Mirrors App.jsx ASSETS: NVDA price 184.2, maxLTV 0.60, liqThreshold 0.68
        //                          AAPL price 231.5, maxLTV 0.68, liqThreshold 0.75
        _mintAndSupply("NVDA", borrower, 10e18);
        _mintAndSupply("AAPL", borrower, 5e18);

        vm.prank(borrower);
        pool.borrow(tokenOf["USDG"], 1_000e18, 2, 0, borrower);

        // computePosition() equivalent, done in plain fixed-point math:
        // liqValue = 10*184.2*0.68 + 5*231.5*0.75 = 2120.685
        // healthFactor = liqValue / borrowed = 2120.685 / 1000
        uint256 expectedHealthFactorWad = 2120.685e18 / 1000;

        (,,, uint256 currentLiquidationThreshold, , uint256 onChainHealthFactor) = _accountData(borrower);
        assertApproxEqRel(onChainHealthFactor, expectedHealthFactorWad, 1e14, "health factor should match computePosition() math");

        // Sanity check the aggregation itself: weighted-average liq threshold
        // across NVDA (68%) and AAPL (75%) weighted by collateral value
        // (1842 vs 1157.5) should land at roughly 70.7%, not either asset's
        // number alone — proof this is pooled, not isolated per-asset.
        assertApproxEqRel(currentLiquidationThreshold, 7070, 3e15, "liq threshold should be collateral-weighted across both assets");
    }

    function test_CollateralOnlyReserveRejectsBorrow() public {
        _mintAndSupply("USDG", borrower, 10_000e18);

        vm.prank(borrower);
        vm.expectRevert();
        pool.borrow(tokenOf["AAPL"], 1e18, 2, 0, borrower);
    }

    function test_PriceDropMakesPositionLiquidatable() public {
        _mintAndSupply("NVDA", borrower, 10e18); // $1,842 collateral, 60% maxLTV -> $1,105.20 borrow limit, 68% liq threshold -> $1,252.56 liq value

        vm.prank(borrower);
        pool.borrow(tokenOf["USDG"], 1_000e18, 2, 0, borrower); // near the borrow limit, still healthy (liq value > debt)

        (,,,,, uint256 healthFactorBefore) = _accountData(borrower);
        assertGt(healthFactorBefore, 1e18, "should start above 1.0");

        // Crash NVDA 40%: collateral now worth $1,105.20, liq value $751.54 — below the $1,000 borrowed.
        MockPriceFeed(priceFeedOf["NVDA"]).updateAnswer(184.2e8 * 60 / 100);

        (,,,,, uint256 healthFactorAfter) = _accountData(borrower);
        assertLt(healthFactorAfter, 1e18, "price crash should push health factor below 1.0");

        // Liquidator needs raw USDG in hand to repay the borrower's debt — unlike
        // the liquidity provider and borrower above, it must NOT be supplied first.
        MintableERC20(tokenOf["USDG"]).mint(liquidator, 10_000e18);
        vm.startPrank(liquidator);
        MintableERC20(tokenOf["USDG"]).approve(address(pool), type(uint256).max);
        pool.liquidationCall(tokenOf["NVDA"], tokenOf["USDG"], borrower, 500e18, false);
        vm.stopPrank();

        (, uint256 totalDebtAfterLiquidation,,,,) = _accountData(borrower);
        assertLt(totalDebtAfterLiquidation, 1_000e18, "liquidation should have repaid part of the debt");
    }

    function _mintAndSupply(string memory ticker, address user, uint256 amount) internal {
        MintableERC20 token = MintableERC20(tokenOf[ticker]);
        token.mint(user, amount);
        vm.startPrank(user);
        token.approve(address(pool), amount);
        pool.supply(address(token), amount, user, 0);
        vm.stopPrank();
    }

    function _accountData(address user)
        internal
        view
        returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)
    {
        (totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor) = pool.getUserAccountData(user);
    }
}
