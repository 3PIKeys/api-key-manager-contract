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
  mapping(uint64 => Tier) tier;

  /****************************************
   * Tier index tracker
   ****************************************/
  uint64 currentTierId = 0;

  /****************************************
   * Key Hash Map
   ****************************************
   * Maps the API key hashes to their key
   * definitions.
   ****************************************/
  mapping(bytes32 => KeyDef) keyDef;

  /****************************************
   * Owner key count map
   ****************************************
   * Maps an owner address to number of
   * keys owned.
   ****************************************/
  mapping(address => uint256) keyCount;

  /****************************************
   * Key Id Map
   ****************************************
   * Maps the Key ID to the key hash.
   ****************************************/
  mapping(uint256 => bytes32) keyHash;

  /****************************************
   * Current Key Id
   ****************************************/
  uint256 currentKeyId = 0;

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
  modifier _keyExists(bytes32 _keyHash) {
    require(!keyExists(_keyHash), "APIKeyManager: key does not exist");
    _;
  }

  modifier _tierExists(uint64 _tierId) {
    require(_tierId < currentTierId, "APIKeyManager: tier does not exist");
    _;
  }

  /****************************************
   * Internal Functions
   ****************************************/
  function usedBalance(bytes32 _keyHash) internal view virtual _keyExists(_keyHash) returns(uint256) {
    uint256 _startTime = keyDef[_keyHash].startTime;
    uint256 _endTime = keyDef[_keyHash].expiryTime;

    // Ensure that we don't consider time previous to last withdrawal to prevent double claims:
    if(lastWithdrawal > _startTime) {
      _startTime = lastWithdrawal;
    }

    // Return zero if key end time is less or equal to start time:
    if(_endTime <= _startTime) {
      return 0;
    }

    // Calculate used balance from start:
    uint256 _usedTime = _endTime - _startTime;
    uint256 _usedBalance = _usedTime * tierPrice(keyDef[_keyHash].tierId);
    return _usedBalance;
  }

  function acceptPayment(uint256 _amount) internal {
    uint256 _allowance = IERC20(erc20).allowance(_msgSender(), address(this));
    require(_allowance >= _amount, "APIKeyManager: low token allowance");
    IERC20(erc20).transferFrom(_msgSender(), address(this), _amount);
  }

  /****************************************
   * Public Functions
   ****************************************/
  function isTierActive(uint64 _tierId) public view virtual _tierExists(_tierId) returns(bool) {
    return tier[_tierId].active;
  }

  function tierPrice(uint64 _tierId) public view virtual _tierExists(_tierId) returns(uint256) {
    return tier[_tierId].price;
  }
  
  function numTiers() public view virtual returns(uint64) {
    return currentTierId;
  }

  function numKeys() public view virtual returns(uint256) {
    return currentKeyId;
  }

  function keyExists(bytes32 _keyHash) public view virtual returns(bool) {
    return keyDef[_keyHash].owner != address(0);
  }

  function isKeyActive(bytes32 _keyHash) public view virtual _keyExists(_keyHash) returns(bool) {
    return keyDef[_keyHash].expiryTime > block.timestamp;
  }

  function remainingBalance(bytes32 _keyHash) public view virtual _keyExists(_keyHash) returns(uint256) {
    if(!isKeyActive(_keyHash)) {
      return 0;
    } else {
      uint256 _remainingTime = keyDef[_keyHash].expiryTime - block.timestamp;
      return _remainingTime * tierPrice(keyDef[_keyHash].tierId);
    }
  }

  function expiryOf(bytes32 _keyHash) public view virtual _keyExists(_keyHash) returns(uint256) {
    return keyDef[_keyHash].expiryTime;
  }

  function ownerOf(bytes32 _keyHash) public view virtual _keyExists(_keyHash) returns(address) {
    address owner = keyDef[_keyHash].owner;
    require(owner != address(0), "APIKeyManager: invalid key hash");
    return owner;
  }

  function numKeysOf(address owner) public view virtual returns(uint256) {
    uint256 _count = 0;
    uint256 _numKeys = numKeys();
    for(uint256 _id = 0; _id < _numKeys; _id++) {
      if(ownerOf(keyHash[_id]) == owner) {
        _count++;
      }
    }
    return _count;
  }

  function availableWithdrawal() public view virtual returns(uint256) {
    uint256 _numKeys = numKeys();
    uint256 _availableBalance = 0;
    for(uint256 _id = 0; _id < _numKeys; _id++) {
      _availableBalance += usedBalance(keyHash[_id]);
    }
    return _availableBalance;
  }

  /****************************************
   * External Functions
   ****************************************/

  function tierIdOf(bytes32 _keyHash) external view virtual _keyExists(_keyHash) returns(uint64) {
    return keyDef[_keyHash].tierId;
  }
  
  function keysOf(address owner) external view virtual returns(bytes32[] memory) {
    uint256 _numKeys = numKeys();
    uint256 _ownerKeyCount = numKeysOf(owner);
    bytes32[] memory _keyHashes = new bytes32[](_ownerKeyCount);
    uint256 _index = 0;
    for(uint256 _id = 0; _id < _numKeys; _id++) {
      if(ownerOf(keyHash[_id]) == owner) {
        _keyHashes[_index] = keyHash[_id];
        _index++;
      }
    }
    return _keyHashes;
  }

  function activateKey(bytes32 _keyHash, uint256 _msDuration, uint64 _tierId) external nonReentrant() {
    require(!keyExists(_keyHash), "APIKeyManager: key exists");
    require(isTierActive(_tierId), "APIKeyManager: inactive tier");

    // Get target tier price:
    uint256 _tierPrice = tierPrice(_tierId);

    // Accept erc20 payment for _tierPrice * _msDuration:
    uint256 _amount = _tierPrice * _msDuration;
    if(_amount > 0) {
      acceptPayment(_amount);
    }

    // Initialize Key:
    keyDef[_keyHash].expiryTime = block.timestamp + _msDuration;
    keyDef[_keyHash].startTime = block.timestamp;
    keyDef[_keyHash].tierId = _tierId;
    keyDef[_keyHash].owner = _msgSender();
    keyCount[_msgSender()]++;
  }

  function extendKey(bytes32 _keyHash, uint256 _msDuration) external _keyExists(_keyHash) nonReentrant() {
    require(ownerOf(_keyHash) == _msgSender(), "APIKeyManager: not owner");
    uint64 _tierId = keyDef[_keyHash].tierId;
    require(isTierActive(_tierId), "APIKeyManager: inactive tier");

    // Get target tier price:
    uint256 _tierPrice = tierPrice(_tierId);

    // Accept erc20 payment for _tierPrice * _msDuration:
    uint256 _amount = _tierPrice * _msDuration;
    if(_amount > 0) {
      acceptPayment(_amount);
    }

    // Extend the expiry time:
    if(isKeyActive(_keyHash)) {
      keyDef[_keyHash].expiryTime += _msDuration;
    } else {
      keyDef[_keyHash].expiryTime = block.timestamp + _msDuration;
    }
  }

  function deactivateKey(bytes32 _keyHash) external _keyExists(_keyHash) nonReentrant() {
    require(ownerOf(_keyHash) == _msgSender(), "APIKeyManager: not owner");
    uint256 _remainingBalance = remainingBalance(_keyHash);
    require(_remainingBalance > 0, "APIKeyManager: no balance");

    // Expire key:
    keyDef[_keyHash].expiryTime = block.timestamp;

    // Send erc20 payment to owner:
    IERC20(erc20).transfer(_msgSender(), _remainingBalance);
  }

  function addTier(uint256 _price) external onlyOwner {
    tier[currentTierId].price = _price;
    tier[currentTierId].active = true;
    currentTierId++;
  }

  function archiveTier(uint64 _tierId) external onlyOwner _tierExists(_tierId) {
    tier[_tierId].active = false;
  }

  function withdraw() external nonReentrant() onlyOwner {
    uint256 _balance = availableWithdrawal();
    lastWithdrawal = block.timestamp;
    IERC20(erc20).transfer(owner(), _balance);
  }

}
