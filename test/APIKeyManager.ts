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
    const tierPrices = [0, 1, 5, 10, 100];
    for(const price of tierPrices) {
      await (await res.keyManager.addTier(ethers.BigNumber.from(price))).wait();
    }
    return { ...res, tierPrices };
  };
  const getRandomKeySet = () => {
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
      const tierId = 1;
      const payable = tierPrices[tierId] * keyDuration;
      expect(payable).to.be.greaterThan(0);

      // Authorize payable amount **MINUS 1** on erc20:
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, ethers.BigNumber.from(payable).sub(1))).wait();

      // Get test key:
      const { keyHash } = getRandomKeySet();

      // Activate key:
      await expect(keyManager.connect(otherAccounts[0]).activateKey(keyHash, keyDuration, tierId)).to.be.revertedWith("APIKM: low token allowance");
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
      await expect(keyManager.connect(otherAccounts[0]).extendKey(keyHash, addedDuration)).to.be.revertedWith("APIKM: key does not exist");
    });
  });

  describe("withdrawUsedBalances(...)", function() {
    this.timeout(1000 * 1000);

    it("Should reject if no key hashes are provided.", async () => {
      const { keyManager, owner } = await loadFixture(deployAPIKeyManagerWithTiers);
      await expect(keyManager.connect(owner).withdrawUsedBalances([])).to.be.rejectedWith("APIKM: zero hashes");
    });

    it("Should reject if there is nothing to withdraw.", async () => {
      const { keyManager, owner, tierPrices } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Activate free-tier key:
      expect(tierPrices[0]).to.equal(0);
      const { keyHash } = getRandomKeySet();
      await keyManager.connect(owner).activateKey(keyHash, 1_000_000, 0);

      // Try to withdraw zero balance:
      await expect(keyManager.connect(owner).withdrawUsedBalances([keyHash])).to.be.rejectedWith("APIKM: no balance");
    });

    it("Should not allow a withdrawal from an address that is not owner", async () => {
      const { keyManager, otherAccounts } = await loadFixture(deployAPIKeyManagerWithTiers);
      await expect(keyManager.connect(otherAccounts[0]).withdrawUsedBalances([])).to.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should withdraw an amount equal to the amount of seconds passed since the last withdrawal per key multiplied by the tier price.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Calculate payable amount:
      const tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const keyDuration = 60; // 1 min
      const payable = ethers.BigNumber.from(keyDuration).mul(tierPrices[tierId]);
      expect(payable).to.be.greaterThan(0);

      // Activate the key:
      const controller = otherAccounts[0];
      const { keyHash } = getRandomKeySet();
      await erc20.connect(controller).approve(keyManager.address, payable);
      const activateRes = await keyManager.connect(controller).activateKey(keyHash, keyDuration, tierId);
      const activateTimestamp = (await keyManager.provider.getBlock((await activateRes.wait()).blockNumber)).timestamp;

      // Wait for 2 seconds:
      await new Promise((resolve) => {
        setTimeout(resolve, 2000);
      });

      // Get owner balance before withdrawal:
      const ownerBalanceBefore = await erc20.balanceOf(owner.address);

      // Withdraw the used key balance:
      const withdrawRes = await keyManager.connect(owner).withdrawUsedBalances([keyHash]);
      const withdrawTimestamp = (await keyManager.provider.getBlock((await withdrawRes.wait()).blockNumber)).timestamp;
      
      // Calculate the withdrawn amount:
      const activeDuration = withdrawTimestamp - activateTimestamp;
      const expectedWithdrawal = ethers.BigNumber.from(activeDuration).mul(tierPrices[tierId]);

      // Check if it matches the actual amount withdrawn:
      const ownerBalanceAfter = await erc20.balanceOf(owner.address);
      expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(expectedWithdrawal);
    });

    it("Should withdraw the full amount originally deposited for a key when it is expired.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Calculate payable amount:
      const tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const keyDuration = 2; // 2 seconds
      const payable = ethers.BigNumber.from(keyDuration).mul(tierPrices[tierId]);
      expect(payable).to.be.greaterThan(0);

      // Activate the key:
      const controller = otherAccounts[0];
      const { keyHash } = getRandomKeySet();
      await erc20.connect(controller).approve(keyManager.address, payable);
      await keyManager.connect(controller).activateKey(keyHash, keyDuration, tierId);

      // Wait for 1 second more than the key duration:
      await new Promise((resolve) => {
        setTimeout(resolve, 1000 * (keyDuration + 1));
      });

      // Get owner balance before withdrawal:
      const ownerBalanceBefore = await erc20.balanceOf(owner.address);

      // Withdraw the used key balance:
      await keyManager.connect(owner).withdrawUsedBalances([keyHash]);

      // Check if payable amount matches the actual amount withdrawn:
      const ownerBalanceAfter = await erc20.balanceOf(owner.address);
      expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(payable);
    });

    it("Should withdraw the full amount originally deposited for a key when withdrawing multiple times over and beyond the key's lifetime.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Calculate payable amount:
      const tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const keyDuration = 5; // 5 seconds
      const payable = ethers.BigNumber.from(keyDuration).mul(tierPrices[tierId]);
      expect(payable).to.be.greaterThan(0);

      // Activate the key:
      const controller = otherAccounts[0];
      const { keyHash } = getRandomKeySet();
      await erc20.connect(controller).approve(keyManager.address, payable);
      await keyManager.connect(controller).activateKey(keyHash, keyDuration, tierId);
      const localTxTime = Date.now();

      // Get owner balance before withdrawal:
      const ownerBalanceBefore = await erc20.balanceOf(owner.address);

      // Withdraw repeatedly until key is expired:
      const expiry = localTxTime + keyDuration * 1000;
      let withdrawals = 0;
      while(Date.now() < expiry) {
        try {
          await keyManager.connect(owner).withdrawUsedBalances([keyHash]);
          withdrawals++;
        } catch(err) {
          if(err instanceof Error && err.message.match("APIKM: no balance")) {
            break;
          } else {
            throw err;
          }
        }
      }
      expect(withdrawals).to.be.greaterThan(1);
      expect(await keyManager.isKeyActive(keyHash)).to.be.false;

      // Check if payable amount matches the total amount withdrawn:
      const ownerBalanceAfter = await erc20.balanceOf(owner.address);
      expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(payable);
    });

    it("Should allow 255 hashes to be withdrawn from, but reject if asking for more.", async () => {
      const { keyManager, owner, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Ensure the tier we will be using has a price:
      const tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);

      // Authorize all payments for the erc20 token:
      (await erc20.connect(owner).approve(keyManager.address, ethers.constants.MaxUint256)).wait();

      // Activate 255 keys:
      const maxKeys = 255;
      const keyHashes: string[] = [];
      const promises: Promise<any>[] = [];
      for(let i = 0; i < maxKeys; i++) {
        const keyDuration = 1_000_000;
        const keyHash = getRandomKeySet().keyHash;
        keyHashes.push(keyHash);
        promises.push(keyManager.connect(owner).activateKey(keyHash, keyDuration, tierId));
      }
      await Promise.all(promises);

      // Wait for 1 second:
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      // Ensure keyHashes.length is equal to maxKeys:
      expect(keyHashes.length).to.equal(maxKeys);

      // Withdraw available funds:
      await expect(keyManager.connect(owner).withdrawUsedBalances(keyHashes)).to.not.be.rejected;

      // Activate one more key and add it to the hash list:
      const keyDuration = 1_000_000;
      const keyHash = getRandomKeySet().keyHash;
      keyHashes.push(keyHash);
      await keyManager.connect(owner).activateKey(keyHash, keyDuration, tierId);

      // Try to withdraw funds with additional key:
      await expect(keyManager.connect(owner).withdrawUsedBalances(keyHashes)).to.be.revertedWith("APIKM: too many hashes");
    });

    it("Should cost a reasonable amount of gas to withdraw from 100 keys (subjective)", async () => {
      const { keyManager, owner, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Ensure at least one payed tier is active:
      expect(tierPrices.length).to.be.greaterThan(0);
      expect(Math.max(...tierPrices)).to.be.greaterThan(0);

      // Authorize all payments for the erc20 token:
      (await erc20.connect(owner).approve(keyManager.address, ethers.constants.MaxUint256)).wait();

      // Create 1 hundred active keys with pseudo-random payment periods under 100 second
      const numKeys = 100;
      const promises: Promise<any>[] = [];
      const keyHashes: string[] = [];
      for(let i = 0; i < numKeys; i++) {
        const keyDuration = Math.floor(Math.random() * 1000 * 100); // 0 - 100 seconds
        const tierId = Math.floor(Math.random() * tierPrices.length); // random tier ID
        const keyHash = getRandomKeySet().keyHash;
        keyHashes.push(keyHash);
        promises.push(keyManager.connect(owner).activateKey(keyHash, keyDuration, tierId));
      }
      await Promise.all(promises);

      // Check numKeys:
      expect(await keyManager.numKeys()).to.equal(numKeys);
      
      // Wait for 1 second:
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      // Withdraw available funds:
      const res = await keyManager.connect(owner).withdrawUsedBalances(keyHashes);
      const waitRes = await res.wait();
      expect(waitRes.gasUsed).to.be.lessThan(numKeys * 20_000);

    });
  });

});