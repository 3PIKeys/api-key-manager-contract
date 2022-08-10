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
  const getRandomKeySet = () => {
    // Create new key bytes:
    const privateKey: Uint8Array = new Uint8Array(32);
    for(let i = 0; i < privateKey.length; i++) {
      privateKey[i] = Math.floor(Math.random() * 16);
    }

    // Hash key:
    const keyHash = ethers.utils.keccak256(privateKey);
    
    // Return keys:
    return { privateKey, keyHash };
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
      await (await erc20.connect(account1).approve(keyManager.address, ethers.BigNumber.from(payable))).wait();

      // Get test key:
      const { keyHash } = getRandomKeySet();

      // Activate key:
      await (await keyManager.connect(account1).activateKey(keyHash, ethers.BigNumber.from(keyDuration), tierId)).wait();
      expect(await keyManager.isKeyActive(keyHash)).to.be.true;
    });
    it("Should revert if allowance is too low", async () => {
      const { keyManager, account1, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Get payable amount:
      const keyDuration = 1000 * 60 * 60; // 1 hour
      const tierId = 0;
      const payable = tierPrices[tierId] * keyDuration;
      expect(payable).to.be.greaterThan(0);

      // Authorize payable amount **MINUS 1** on erc20:
      await (await erc20.connect(account1).approve(keyManager.address, ethers.BigNumber.from(payable).sub(1))).wait();

      // Get test key:
      const { keyHash } = getRandomKeySet();

      // Activate key:
      await expect(keyManager.connect(account1).activateKey(keyHash, ethers.BigNumber.from(keyDuration), tierId)).to.be.revertedWith("APIKeyManager: low token allowance");
    });
  });

  describe("extendKey(...)", async () => {
    it("Should allow the owner of a key to extend its duration", async () => {
      const { keyManager, account1, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);
      
      // Deploy Key:
      const keyDuration = 1000 * 60 * 60; // 1 hour
      const tierId = 0;
      const payable = tierPrices[tierId] * keyDuration;
      await (await erc20.connect(account1).approve(keyManager.address, ethers.BigNumber.from(payable))).wait();
      const { keyHash } = getRandomKeySet();
      await (await keyManager.connect(account1).activateKey(keyHash, ethers.BigNumber.from(keyDuration), tierId)).wait();

      // Get expiry:
      const lastExpiry = await keyManager.expiryOf(keyHash);

      // Extend duration:
      const addedDuration = 1000 * 60 * 30; // 30 min
      const payable2 = tierPrices[tierId] * addedDuration;
      await (await erc20.connect(account1).approve(keyManager.address, ethers.BigNumber.from(payable2))).wait();
      await (await keyManager.connect(account1).extendKey(keyHash, ethers.BigNumber.from(addedDuration))).wait();
      expect(await keyManager.expiryOf(keyHash)).to.equal(lastExpiry.add(addedDuration));
    });
    it("Should NOT allow an extension to a key that does not exist", async () => {
      const { keyManager, account1, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Try to extend duration:
      const { keyHash } = getRandomKeySet();
      const addedDuration = 1000 * 60 * 30; // 30 min
      const payable2 = tierPrices[0] * addedDuration;
      await (await erc20.connect(account1).approve(keyManager.address, ethers.BigNumber.from(payable2))).wait();
      await expect(keyManager.connect(account1).extendKey(keyHash, ethers.BigNumber.from(addedDuration))).to.be.revertedWith("APIKeyManager: key does not exist");
    });
  });

});