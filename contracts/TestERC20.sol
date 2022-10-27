// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("Gimme Token", "GIM") {
    _mint(_msgSender(), 1000000000 * (10**18));
  }
}