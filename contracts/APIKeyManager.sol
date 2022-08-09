// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Import this file to use console.log
import "hardhat/console.sol";

contract APIKeyManager is Ownable {

  /****************************************
   * Structs
   ****************************************/
  struct KeyDef {
    uint256 expiry;
    uint256 tier;
  }
  
  /****************************************
   * ERC20 Token
   ****************************************/
  IERC20 public erc20;

  /****************************************
   * Key Tier Prices
   ****************************************/
  uint256[] private tierPricePerBlock;

  /****************************************
   * Key Hash Map
   ****************************************/
  mapping(bytes32 => KeyDef) keyDef;

  /****************************************
   * Constructor
   ****************************************/
  constructor(
    IERC20 _erc20,
    uint256[] memory _tierPricePerBlock
  ) Ownable() {
    erc20 = _erc20;
    setTierPrices(_tierPricePerBlock);
  }

  /****************************************
   * Public Functions
   ****************************************/
  function setTierPrices(uint256[] memory _tierPricePerBlock) public onlyOwner {
    tierPricePerBlock = _tierPricePerBlock;
  }

  function tierPrice(uint256 tier) public view returns(uint256) {
    require(tier < tierPricePerBlock.length, "APIKeyManager: no such tier");
    return tierPricePerBlock[tier];
  }
  
  function numTiers() public view returns(uint256) {
    return tierPricePerBlock.length;
  }

  /****************************************
   * External Functions
   ****************************************/
  function activateKey(bytes32 _keyHash, uint256 _blockDuration, uint256 _tier) public {
    require(keyDef[_keyHash].expiry == 0, "APIKeyManager: key already exists");
    require(_tier < numTiers(), "APIKeyManager: no such tier");

    // TODO: accept erc20 payment for _blockDuration * tierPrice(_tier);

    keyDef[_keyHash].expiry = block.number + _blockDuration;
    keyDef[_keyHash].tier = _tier;
  }
}
