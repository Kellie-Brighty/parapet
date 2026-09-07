// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/// @notice Chainlink-shaped price feed for local testing. Unlike Aave's own
/// MockAggregator (constructor-only price), this exposes `updateAnswer` so
/// tests can move a price after setup — needed to push a position across its
/// liquidation threshold. Swap for a real Chainlink feed at deploy time by
/// pointing AaveOracle at a different `source` address; nothing else changes.
contract MockPriceFeed {
    int256 private _latestAnswer;
    uint256 private _updatedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(int256 initialAnswer) {
        _latestAnswer = initialAnswer;
        _updatedAt = block.timestamp;
        emit AnswerUpdated(initialAnswer, 0, block.timestamp);
    }

    function updateAnswer(int256 newAnswer) external {
        _latestAnswer = newAnswer;
        _updatedAt = block.timestamp;
        emit AnswerUpdated(newAnswer, 0, block.timestamp);
    }

    function latestAnswer() external view returns (int256) {
        return _latestAnswer;
    }

    function latestTimestamp() external view returns (uint256) {
        return _updatedAt;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }
}
