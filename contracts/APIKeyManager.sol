// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

uint256 constant MAX_UINT8 = 2**8-1;

contract APIKeyManager is Ownable, ReentrancyGuard {

  /****************************************
   * Structs
   ****************************************/
  struct KeyDef {
    uint256 startTime;  // ms
    uint256 expiryTime; // ms
    uint256 lastWithdrawal; // ms
    address owner;
    uint64 tierId;
  }

  struct Tier {
    uint256 price; // price per millisecond
    bool active;
  }

  /****************************************
   * Events
   ****************************************/
  event ActivateKey(bytes32 indexed keyHash, address indexed owner);
  event AddTier(uint256 indexed tierId, uint256 price);
  event ArchiveTier(uint256 indexed tierId);
  
  /****************************************
   * ERC20 Token
   ****************************************
   * @dev
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
   * @dev
   * Maps the API key hashes to their key
   * definitions.
   ****************************************/
  mapping(bytes32 => KeyDef) private _keyDef;

  /****************************************
   * Key Id Map
   ****************************************
   * @dev
   * Maps the Key ID to the key hash.
   ****************************************/
  mapping(uint256 => bytes32) private _keyHash;

  /****************************************
   * Current Key Id
   ****************************************/
  uint256 private _currentKeyId = 0;

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
    require(keyExists(keyHash), "APIKM: key does not exist");
    _;
  }

  modifier _tierExists(uint64 tierId) {
    require(tierId < _currentTierId, "APIKM: tier does not exist");
    _;
  }

  /****************************************
   * Internal Functions
   ****************************************/

  /**
    @dev Calculate the used balance available for withdrawal 
    for a given key at a timestamp.
  */
  function usedBalance(bytes32 keyHash, uint256 timestamp) internal view _keyExists(keyHash) returns(uint256) {
    uint256 lastWithdrawal = _keyDef[keyHash].lastWithdrawal;
    uint256 expiryTime = _keyDef[keyHash].expiryTime;

    // Only consider up to the expiry time of the key:
    if(expiryTime < timestamp) {
      timestamp = expiryTime;
    }

    // Return zero if key end time is less or equal to start time:
    if(timestamp <= lastWithdrawal) {
      return 0;
    }

    // Calculate used balance:
    uint256 usedTime = timestamp - lastWithdrawal;
    uint256 _usedBalance = usedTime * tierPrice(_keyDef[keyHash].tierId);
    return _usedBalance;
  }

  /**
    @dev Accepts an ERC20 payment for the given amount from
    the message sender if the allowance permits.
  */
  function acceptPayment(uint256 amount) internal {
    uint256 _allowance = IERC20(erc20).allowance(_msgSender(), address(this));
    require(_allowance >= amount, "APIKM: low token allowance");
    IERC20(erc20).transferFrom(_msgSender(), address(this), amount);
  }

  /****************************************
   * Public Functions
   ****************************************/

  /**
    @dev Checks if the given tier is active.
  */
  function isTierActive(uint64 tierId) public view _tierExists(tierId) returns(bool) {
    return _tier[tierId].active;
  }

  /**
    @dev Returns the price of a given tier.
  */
  function tierPrice(uint64 tierId) public view _tierExists(tierId) returns(uint256) {
    return _tier[tierId].price;
  }
  
  /**
    @dev Returns the current number of tiers.
    (active and archived)
  */
  function numTiers() public view returns(uint64) {
    return _currentTierId;
  }

  /**
    @dev Returns the current number of keys created.
    (active and not active)
  */
  function numKeys() public view returns(uint256) {
    return _currentKeyId;
  }

  /**
    @dev Checks if the key with the given hash has been activated
    at any point.
  */
  function keyExists(bytes32 keyHash) public view returns(bool) {
    return _keyDef[keyHash].owner != address(0);
  }

  /**
    @dev Determines if the key with the given hash is active.
  */
  function isKeyActive(bytes32 keyHash) public view _keyExists(keyHash) returns(bool) {
    return _keyDef[keyHash].expiryTime > block.timestamp;
  }

  /**
    @dev Calculates the remaining balance for the key with the
    given hash.
  */
  function remainingBalance(bytes32 keyHash) public view _keyExists(keyHash) returns(uint256) {
    if(!isKeyActive(keyHash)) {
      return 0;
    } else {
      uint256 _remainingTime = _keyDef[keyHash].expiryTime - block.timestamp;
      return _remainingTime * tierPrice(_keyDef[keyHash].tierId);
    }
  }

  /**
    @dev Returns the key info for the given hash.
  */
  function keyInfo(bytes32 keyHash) public view _keyExists(keyHash) returns(KeyDef memory) {
    return _keyDef[keyHash];
  }

  /**
    @dev Returns the used balances available for withdrawal for
    the keys with the given hashes at the given timestamp.
  */
  function usedBalances(bytes32[] calldata keyHashes, uint256 timestamp) public view returns(uint256) {
    uint256 balance = 0;
    for(uint8 i = 0; i < uint8(keyHashes.length); i++) {
      balance += usedBalance(keyHashes[i], timestamp);
    }
    return balance;
  }

  /****************************************
   * External Functions
   ****************************************/

  /**
    @dev Activates a new key with the given hash. Accepts payment
    for the initial duration at the target tier price.
  */
  function activateKey(bytes32 keyHash, uint256 msDuration, uint64 tierId) external nonReentrant() {
    require(!keyExists(keyHash), "APIKM: key exists");
    require(isTierActive(tierId), "APIKM: inactive tier");

    // Get target tier price:
    uint256 _tierPrice = tierPrice(tierId);

    // Accept erc20 payment for _tierPrice * msDuration:
    uint256 _amount = _tierPrice * msDuration;
    if(_amount > 0) {
      acceptPayment(_amount);
    }

    // Initialize Key:
    _keyHash[_currentKeyId++] = keyHash;
    _keyDef[keyHash].expiryTime = block.timestamp + msDuration;
    _keyDef[keyHash].startTime = block.timestamp;
    _keyDef[keyHash].lastWithdrawal = block.timestamp;
    _keyDef[keyHash].tierId = tierId;
    _keyDef[keyHash].owner = _msgSender();

    // Emit Transfer event:
    emit ActivateKey(keyHash, _msgSender());
  }

  /**
    @dev Extends the lifetime of a key by accepting a new
    deposit to the key balance.
  */
  function extendKey(bytes32 keyHash, uint256 msDuration) external _keyExists(keyHash) nonReentrant() {
    require(_keyDef[keyHash].owner == _msgSender(), "APIKM: not owner");
    uint64 tierId = _keyDef[keyHash].tierId;
    require(isTierActive(tierId), "APIKM: inactive tier");

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

  /**
    @dev Deactivates a key and returns the unused balance to 
    the key owner.
  */
  function deactivateKey(bytes32 keyHash) external _keyExists(keyHash) nonReentrant() {
    require(_keyDef[keyHash].owner == _msgSender(), "APIKM: not owner");
    uint256 _remainingBalance = remainingBalance(keyHash);
    require(_remainingBalance > 0, "APIKM: no balance");

    // Expire key:
    _keyDef[keyHash].expiryTime = block.timestamp;

    // Send erc20 payment to owner:
    IERC20(erc20).transfer(_msgSender(), _remainingBalance);
  }

  /**
    @dev Appends a new tier with the given price.
  */
  function addTier(uint256 price) external onlyOwner {
    uint64 tierId = _currentTierId++;
    _tier[tierId].price = price;
    _tier[tierId].active = true;
    emit AddTier(tierId, price);
  }

  /**
    @dev Archives the given tier. This tier will no longer be
    available for key creation or renewal.
  */
  function archiveTier(uint64 tierId) external onlyOwner _tierExists(tierId) {
    _tier[tierId].active = false;
    emit ArchiveTier(tierId);
  }

  /**
    @dev Returns the total used balances available for withdrawal.
  */
  function allUsedBalances(uint256 timestamp) external view returns(uint256) {
    uint256 _numKeys = numKeys();
    uint256 balance = 0;
    for(uint256 id = 0; id < _numKeys; id++) {
      balance += usedBalance(_keyHash[id], timestamp);
    }
    return balance;
  }

  /**
    @dev Withdraws the used balances of the given keyHashes.
    Limitations are in place to prevent too many withdrawals
    at once since the usedBalances(...) function is gas-heavy.
  */
  function withdrawUsedBalances(bytes32[] calldata keyHashes) external nonReentrant() onlyOwner {
    require(keyHashes.length > 0, "APIKM: zero hashes");
    require(keyHashes.length <= MAX_UINT8, "APIKM: too many hashes");
    uint256 balance = usedBalances(keyHashes, block.timestamp);
    require(balance > 0, "APIKM: no balance");
    IERC20(erc20).transfer(owner(), balance);
  }

}
