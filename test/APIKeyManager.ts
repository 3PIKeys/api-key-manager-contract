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
    const [owner, ...others] = await ethers.getSigners();
    for(const account of others) {
      await (await erc20.connect(owner).transfer(account.address, ethers.BigNumber.from(1_000).mul(ethers.BigNumber.from(10).pow(18)))).wait();
    }

    return erc20;
  };
  const deployAPIKeyManager = async () => {
    const [owner, ...otherAccounts] = await ethers.getSigners();
    const erc20 = await deployTestERC20();
    const APIKeyManager = await ethers.getContractFactory("APIKeyManager");
    const keyManager = await APIKeyManager.deploy(erc20.address);
    return { keyManager, owner, otherAccounts, erc20 };
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
    // const privateKey: Uint8Array = new Uint8Array(32);
    // for(let i = 0; i < privateKey.length; i++) {
    //   privateKey[i] = Math.floor(Math.random() * 16);
    // }
    const privateKey = ethers.utils.randomBytes(32);

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
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);
      
      // Get payable amount:
      const keyDuration = 1000 * 60 * 60; // 1 hour
      const tierId = 0;
      const payable = tierPrices[tierId] * keyDuration;

      // Authorize payable amount on erc20:
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, payable)).wait();

      // Get test key:
      const { keyHash } = getRandomKeySet();

      // Activate key:
      await (await keyManager.connect(otherAccounts[0]).activateKey(keyHash, keyDuration, tierId)).wait();
      expect(await keyManager.isKeyActive(keyHash)).to.be.true;
    });
    it("Should revert if allowance is too low", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Get payable amount:
      const keyDuration = 1000 * 60 * 60; // 1 hour
      const tierId = 0;
      const payable = tierPrices[tierId] * keyDuration;
      expect(payable).to.be.greaterThan(0);

      // Authorize payable amount **MINUS 1** on erc20:
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, ethers.BigNumber.from(payable).sub(1))).wait();

      // Get test key:
      const { keyHash } = getRandomKeySet();

      // Activate key:
      await expect(keyManager.connect(otherAccounts[0]).activateKey(keyHash, keyDuration, tierId)).to.be.revertedWith("APIKeyManager: low token allowance");
    });
  });

  describe("extendKey(...)", async () => {
    it("Should allow the owner of a key to extend its duration", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);
      
      // Deploy Key:
      const keyDuration = 1000 * 60 * 60; // 1 hour
      const tierId = 0;
      const payable = ethers.BigNumber.from(tierPrices[tierId]).mul(keyDuration);
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, payable)).wait();
      const { keyHash } = getRandomKeySet();
      await (await keyManager.connect(otherAccounts[0]).activateKey(keyHash, keyDuration, tierId)).wait();

      // Get expiry:
      const lastExpiry = (await keyManager.keyInfo(keyHash)).expiryTime;

      // Extend duration:
      const addedDuration = 1000 * 60 * 30; // 30 min
      const payable2 = ethers.BigNumber.from(tierPrices[tierId]).mul(addedDuration);
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, payable2)).wait();
      await (await keyManager.connect(otherAccounts[0]).extendKey(keyHash, addedDuration)).wait();
      expect((await keyManager.keyInfo(keyHash)).expiryTime).to.equal(lastExpiry.add(addedDuration));
    });
    it("Should NOT allow an extension to a key that does not exist", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Try to extend duration:
      const { keyHash } = getRandomKeySet();
      const addedDuration = 1000 * 60 * 30; // 30 min
      const payable2 = ethers.BigNumber.from(tierPrices[0]).mul(addedDuration);
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, payable2)).wait();
      await expect(keyManager.connect(otherAccounts[0]).extendKey(keyHash, addedDuration)).to.be.revertedWith("APIKeyManager: key does not exist");
    });
  });

  // describe("withdraw()", function() {
  //   this.timeout(1000 * 1000);
  //   it("Should cost a reasonable amount of gas at 1 thousand active keys", async () => {
  //     const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

  //     // Authorize all payments:
  //     (await erc20.connect(owner).approve(keyManager.address, ethers.constants.MaxUint256)).wait();

  //     // Create 1 thousand active keys with pseudo-random payment periods within 100 second
  //     const numKeys = 2_000;
  //     const promises: Promise<any>[] = [];
  //     for(let i = 0; i < numKeys; i++) {
  //       const keyDuration = Math.floor(Math.random() * 1000 * 100); // 0 - 100 seconds
  //       const tierId = Math.floor(Math.random() * tierPrices.length);
  //       promises.push(keyManager.connect(owner).activateKey(getRandomKeySet().keyHash, keyDuration, tierId));
  //     }
  //     console.log("Sent all key activation transactions");
  //     await Promise.all(promises);
  //     console.log("All key activations complete");

  //     // Check numKeys:
  //     expect(await keyManager.numKeys()).to.equal(numKeys);
      
  //     // Wait for 1 second:
  //     await new Promise((resolve) => {
  //       setTimeout(resolve, 1000);
  //     });
  //     console.log("Waited for 1 sec");

  //     // Withdraw available funds:
  //     const res = await keyManager.connect(owner).withdraw();
  //     console.log(res);
  //     const waitRes = await res.wait();
  //     console.log(waitRes);
  //     expect(waitRes.gasUsed).to.be.lessThan(100_000);

  //   });
  // });

});