// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("Gimme Token", "GIM") {
    _mint(_msgSender(), 1000000 * (10**18));
  }
}