import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("APIKeyManager", () => {

  const deployTestERC20 = async () => {
    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const erc20 = await TestERC20.deploy();
    await erc20.deployed();
    return erc20.address;
  };
  const deployAPIKeyManager = async () => {
    const [owner, account1, account2] = await ethers.getSigners();
    const erc20Address = await deployTestERC20();
    const APIKeyManager = await ethers.getContractFactory("APIKeyManager");
    const keyManager = await APIKeyManager.deploy(erc20Address);
    await keyManager.deployed();
    return { keyManager, owner, account1, account2 };
  };

  describe("Deployment", function () {
    it("Should set the right ERC20 token address", async () => {
      const { keyManager } = await loadFixture(deployAPIKeyManager);
    });
  });

});