// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("3PI Test Token", "3PI") { }
  function mint(uint256 _amount) public {
    _mint(_msgSender(), _amount);
  }
}