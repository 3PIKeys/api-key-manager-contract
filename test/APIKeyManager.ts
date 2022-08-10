import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("APIKeyManager", () => {

  const deployTestERC20 = async () => {
    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const erc20 = await TestERC20.deploy();
    await erc20.deployed();

    // Assign initial balances:
    const signers = await ethers.getSigners();
    for(const signer of signers) {
      await (await erc20.connect(signer).mint(ethers.BigNumber.from(1_000).mul(ethers.BigNumber.from(10).pow(18)))).wait();
    }

    return erc20;
  };
  const deployAPIKeyManager = async () => {
    const [owner, account1, account2] = await ethers.getSigners();
    const erc20 = await deployTestERC20();
    const APIKeyManager = await ethers.getContractFactory("APIKeyManager");
    const keyManager = await APIKeyManager.deploy(erc20.address);
    await keyManager.deployed();
    return { keyManager, owner, account1, account2, erc20 };
  };
  const deployAPIKeyManagerWithTiers = async () => {
    const res = await deployAPIKeyManager();
    const tierPrices = [1, 5, 10, 100];
    for(const price of tierPrices) {
      await (await res.keyManager.addTier(ethers.BigNumber.from(price))).wait();
    }
    return { ...res, tierPrices };
  };

  describe("Deployment", () => {
    it("Should set the right ERC20 token address", async () => {
      const { keyManager, erc20 } = await loadFixture(deployAPIKeyManager);
      expect(await keyManager.erc20()).to.equal(erc20.address);
    });
  });

  describe("activateKey(...)", () => {
    it("Should activate a valid key with correct payment", async () => {
      const { keyManager, account1, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);
      
      // Get payable amount:
      const keyDuration = 1000 * 60 * 60; // 1 hour
      const tierId = 0;
      const payable = tierPrices[tierId] * keyDuration;

      // Authorize payable amount on erc20:
      await (await erc20.approve(keyManager.address, ethers.BigNumber.from(payable))).wait();

      // Create new key bytes:
      const privateKey: Uint8Array = new Uint8Array(32);
      for(let i = 0; i < privateKey.length; i++) {
        privateKey[i] = Math.floor(Math.random() * 16);
      }
      console.log(privateKey);

      // Hash key:
      const keyHash = ethers.utils.keccak256(privateKey);
      console.log(keyHash);

      // Activate key:
      await (await keyManager.activateKey(keyHash, ethers.BigNumber.from(keyDuration), tierId)).wait();
      expect(await keyManager.isKeyActive(keyHash)).to.be.true;
    });
  });

});