// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract APIKeyManager is Ownable, ReentrancyGuard {

  /****************************************
   * Structs
   ****************************************/
  struct KeyDef {
    uint256 startTime;  // ms
    uint256 expiryTime; // ms
    address owner;
    uint64 tierId;
  }

  struct Tier {
    uint256 price; // price per millisecond
    bool active;
  }
  
  /****************************************
   * ERC20 Token
   ****************************************
   * This is the address for the token that 
   * will be accepted for key payment.
   ****************************************/
  IERC20 public erc20;

  /****************************************
   * Key Tiers
   ****************************************
   * Tier Definition mapping
   ****************************************/
  mapping(uint64 => Tier) private _tier;

  /****************************************
   * Tier index tracker
   ****************************************/
  uint64 private _currentTierId = 0;

  /****************************************
   * Key Hash Map
   ****************************************
   * Maps the API key hashes to their key
   * definitions.
   ****************************************/
  mapping(bytes32 => KeyDef) private _keyDef;

  /****************************************
   * Owner key count map
   ****************************************
   * Maps an owner address to number of
   * keys owned.
   ****************************************/
  mapping(address => uint256) private _keyCount;

  /****************************************
   * Key Id Map
   ****************************************
   * Maps the Key ID to the key hash.
   ****************************************/
  mapping(uint256 => bytes32) private _keyHash;

  /****************************************
   * Current Key Id
   ****************************************/
  uint256 private _currentKeyId = 0;

  /****************************************
   * Last Admin Withdrawal Timestamp
   ****************************************
   * Used to prevent double withdrawals of
   * user funds.
   ****************************************/
  uint256 public lastWithdrawal;

  /****************************************
   * Constructor
   ****************************************/
  constructor(
    IERC20 _erc20
  ) Ownable() ReentrancyGuard() {
    erc20 = _erc20;
  }

  /****************************************
   * Modifiers
   ****************************************/
  modifier _keyExists(bytes32 keyHash) {
    require(keyExists(keyHash), "APIKeyManager: key does not exist");
    _;
  }

  modifier _tierExists(uint64 tierId) {
    require(tierId < _currentTierId, "APIKeyManager: tier does not exist");
    _;
  }

  /****************************************
   * Internal Functions
   ****************************************/

  /** @dev Calculate the  */
  function usedBalance(bytes32 keyHash) internal view _keyExists(keyHash) returns(uint256) {
    uint256 startTime = _keyDef[keyHash].startTime;
    uint256 endTime = _keyDef[keyHash].expiryTime;

    // Ensure that we don't consider time previous to last withdrawal to prevent double claims:
    if(lastWithdrawal > startTime) {
      startTime = lastWithdrawal;
    }

    // Return zero if key end time is less or equal to start time:
    if(endTime <= startTime) {
      return 0;
    }

    // Calculate used balance from start:
    uint256 usedTime = endTime - startTime;
    uint256 _usedBalance = usedTime * tierPrice(_keyDef[keyHash].tierId);
    return _usedBalance;
  }

  function acceptPayment(uint256 amount) internal {
    uint256 _allowance = IERC20(erc20).allowance(_msgSender(), address(this));
    require(_allowance >= amount, "APIKeyManager: low token allowance");
    IERC20(erc20).transferFrom(_msgSender(), address(this), amount);
  }

  /****************************************
   * Public Functions
   ****************************************/
  function isTierActive(uint64 tierId) public view _tierExists(tierId) returns(bool) {
    return _tier[tierId].active;
  }

  function tierPrice(uint64 tierId) public view _tierExists(tierId) returns(uint256) {
    return _tier[tierId].price;
  }
  
  function numTiers() public view returns(uint64) {
    return _currentTierId;
  }

  function numKeys() public view returns(uint256) {
    return _currentKeyId;
  }

  function keyExists(bytes32 keyHash) public view returns(bool) {
    return _keyDef[keyHash].owner != address(0);
  }

  function isKeyActive(bytes32 keyHash) public view _keyExists(keyHash) returns(bool) {
    return _keyDef[keyHash].expiryTime > block.timestamp;
  }

  function remainingBalance(bytes32 keyHash) public view _keyExists(keyHash) returns(uint256) {
    if(!isKeyActive(keyHash)) {
      return 0;
    } else {
      uint256 _remainingTime = _keyDef[keyHash].expiryTime - block.timestamp;
      return _remainingTime * tierPrice(_keyDef[keyHash].tierId);
    }
  }

  function expiryOf(bytes32 keyHash) public view _keyExists(keyHash) returns(uint256) {
    return _keyDef[keyHash].expiryTime;
  }

  function ownerOf(bytes32 keyHash) public view _keyExists(keyHash) returns(address) {
    address owner = _keyDef[keyHash].owner;
    require(owner != address(0), "APIKeyManager: invalid key hash");
    return owner;
  }

  function numKeysOf(address owner) public view returns(uint256) {
    uint256 _count = 0;
    uint256 _numKeys = numKeys();
    for(uint256 _id = 0; _id < _numKeys; _id++) {
      if(ownerOf(_keyHash[_id]) == owner) {
        _count++;
      }
    }
    return _count;
  }

  function availableWithdrawal() public view returns(uint256) {
    uint256 _numKeys = numKeys();
    uint256 _availableBalance = 0;
    for(uint256 _id = 0; _id < _numKeys; _id++) {
      _availableBalance += usedBalance(_keyHash[_id]);
    }
    return _availableBalance;
  }

  /****************************************
   * External Functions
   ****************************************/

  function tierIdOf(bytes32 keyHash) external view _keyExists(keyHash) returns(uint64) {
    return _keyDef[keyHash].tierId;
  }
  
  function keysOf(address owner) external view returns(bytes32[] memory) {
    uint256 _numKeys = numKeys();
    uint256 _ownerKeyCount = numKeysOf(owner);
    bytes32[] memory keyHashes = new bytes32[](_ownerKeyCount);
    uint256 _index = 0;
    for(uint256 _id = 0; _id < _numKeys; _id++) {
      if(ownerOf(_keyHash[_id]) == owner) {
        keyHashes[_index] = _keyHash[_id];
        _index++;
      }
    }
    return keyHashes;
  }

  function activateKey(bytes32 keyHash, uint256 msDuration, uint64 tierId) external nonReentrant() {
    require(!keyExists(keyHash), "APIKeyManager: key exists");
    require(isTierActive(tierId), "APIKeyManager: inactive tier");

    // Get target tier price:
    uint256 _tierPrice = tierPrice(tierId);

    // Accept erc20 payment for _tierPrice * msDuration:
    uint256 _amount = _tierPrice * msDuration;
    if(_amount > 0) {
      acceptPayment(_amount);
    }

    // Initialize Key:
    _keyDef[keyHash].expiryTime = block.timestamp + msDuration;
    _keyDef[keyHash].startTime = block.timestamp;
    _keyDef[keyHash].tierId = tierId;
    _keyDef[keyHash].owner = _msgSender();
    _keyCount[_msgSender()]++;
  }

  function extendKey(bytes32 keyHash, uint256 msDuration) external _keyExists(keyHash) nonReentrant() {
    require(ownerOf(keyHash) == _msgSender(), "APIKeyManager: not owner");
    uint64 tierId = _keyDef[keyHash].tierId;
    require(isTierActive(tierId), "APIKeyManager: inactive tier");

    // Get target tier price:
    uint256 _tierPrice = tierPrice(tierId);

    // Accept erc20 payment for _tierPrice * msDuration:
    uint256 _amount = _tierPrice * msDuration;
    if(_amount > 0) {
      acceptPayment(_amount);
    }

    // Extend the expiry time:
    if(isKeyActive(keyHash)) {
      _keyDef[keyHash].expiryTime += msDuration;
    } else {
      _keyDef[keyHash].expiryTime = block.timestamp + msDuration;
    }
  }

  function deactivateKey(bytes32 keyHash) external _keyExists(keyHash) nonReentrant() {
    require(ownerOf(keyHash) == _msgSender(), "APIKeyManager: not owner");
    uint256 _remainingBalance = remainingBalance(keyHash);
    require(_remainingBalance > 0, "APIKeyManager: no balance");

    // Expire key:
    _keyDef[keyHash].expiryTime = block.timestamp;

    // Send erc20 payment to owner:
    IERC20(erc20).transfer(_msgSender(), _remainingBalance);
  }

  function addTier(uint256 price) external onlyOwner {
    _tier[_currentTierId].price = price;
    _tier[_currentTierId].active = true;
    _currentTierId++;
  }

  function archiveTier(uint64 tierId) external onlyOwner _tierExists(tierId) {
    _tier[tierId].active = false;
  }

  function withdraw() external nonReentrant() onlyOwner {
    uint256 _balance = availableWithdrawal();
    lastWithdrawal = block.timestamp;
    IERC20(erc20).transfer(owner(), _balance);
  }

  function transfer(bytes32 keyHash, address to) external _keyExists(keyHash) nonReentrant() {
    require(ownerOf(keyHash) == _msgSender(), "APIKeyManager: not owner");
    _keyCount[ownerOf(keyHash)]--;
    _keyCount[to]++;
    _keyDef[keyHash].owner = to;
  }

}
