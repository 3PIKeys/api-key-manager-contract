import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { APIKeyManager, TestERC20 } from "../typechain-types";
import type { Signer } from "ethers";

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
  const activateRandomKey = async (keyManager: APIKeyManager, signer: Signer, duration: number, tierId: number) => {
    const { keyHash } = getRandomKeySet();
    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const erc20 = TestERC20.attach(await keyManager.erc20());
    const tierPrice = await keyManager.tierPrice(tierId);
    const payable = tierPrice.mul(duration);
    if(payable.gt(0)) {
      await erc20.connect(signer).approve(keyManager.address, payable);
    }
    return { keyHash, tx: await keyManager.connect(signer).activateKey(keyHash, duration, tierId) };
  };
  const extendKey = async (keyManager: APIKeyManager, signer: Signer, keyHash: string, duration: number) => {
    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const erc20 = TestERC20.attach(await keyManager.erc20());
    const tierId = (await keyManager.keyInfo(keyHash)).tierId;
    const tierPrice = await keyManager.tierPrice(tierId);
    const payable = tierPrice.mul(duration);
    if(payable.gt(0)) {
      await erc20.connect(signer).approve(keyManager.address, payable);
    }
    return await keyManager.connect(signer).extendKey(keyHash, duration);
  };

  describe("Deployment", () => {
    it("Should set the right ERC20 token address", async () => {
      const { keyManager, erc20 } = await loadFixture(deployAPIKeyManager);
      expect(await keyManager.erc20()).to.equal(erc20.address);
    });
  });

  describe("isTierActive(...)", function() {});

  describe("tierPrice(...)", function() {});

  describe("numTiers()", function() {});

  describe("numKeys()", function() {});

  describe("realizedProfit()", function() {});

  describe("keyExists(...)", function() {});

  describe("isKeyActive(...)", function() {});

  describe("usedBalance(...)", function() {});

  describe("remainingBalance(...)", function() {});

  describe("realizeProfit(...)", function() {});

  describe("keyInfo(...)", function() {});

  describe("keyHashOf(...)", function() {});

  describe("keyHashesOf(...)", function() {
    this.timeout(1000 * 1000);

    it("Should return an empty array for a controller with no keys.", async () => {
      const { keyManager, otherAccounts } = await loadFixture(deployAPIKeyManager);
      expect(await keyManager.keyHashesOf(otherAccounts[0].address)).to.have.lengthOf(0);
    });

    it("Should return an array containing only the keys for one controller.", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);
      
      // Init 3 random keys for all other accounts:
      const controllerMap = new Map<string, string[]>();
      for(const controller of otherAccounts) {
        for(let i = 0; i < 3; i++) {
          const { keyHash } = getRandomKeySet();
          const duration = Math.floor(Math.random() * 1_000); // 0-1000 seconds
          const tierId = Math.floor(Math.random() * tierPrices.length);
          const payable = ethers.BigNumber.from(duration).mul(tierPrices[tierId]);
          await erc20.connect(controller).approve(keyManager.address, payable);
          await keyManager.connect(controller).activateKey(keyHash, duration, tierId);
          let hashes = controllerMap.get(controller.address);
          if(!hashes) {
            hashes = [];
            controllerMap.set(controller.address, hashes);
          }
          hashes.push(keyHash);
        }
      }

      // Check the keyHashes of each controller on-chain:
      for(const controller of otherAccounts) {
        const expectedHashes = controllerMap.get(controller.address);
        if(!expectedHashes) throw new Error(`missing hashes for controller: ${controller.address}`);
        const hashSet = new Set(expectedHashes);
        const actualHashes = await keyManager.keyHashesOf(controller.address);
        expect(actualHashes.length).to.equal(expectedHashes.length);
        for(const hash of actualHashes) {
          expect(hashSet.has(hash)).to.be.true;
        }
      }
    });

    it("Should include both active and not active keyHashes.", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Deploy two keys:
      const keyHashes = [getRandomKeySet().keyHash, getRandomKeySet().keyHash];
      const controller = otherAccounts[0];
      const duration = 100; // 100 seconds
      const tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const payable = ethers.BigNumber.from(duration).mul(tierPrices[tierId]);
      await erc20.connect(controller).approve(keyManager.address, payable.mul(2));
      await keyManager.connect(controller).activateKey(keyHashes[0], duration, tierId);
      await keyManager.connect(controller).activateKey(keyHashes[1], duration, tierId);

      // Deactivate the second:
      await keyManager.connect(controller).deactivateKey(keyHashes[1]);
      expect(await keyManager.isKeyActive(keyHashes[0])).to.be.true;
      expect(await keyManager.isKeyActive(keyHashes[1])).to.be.false;

      // Check if both keys are included in array:
      const actualHashes = await keyManager.keyHashesOf(controller.address);
      expect(actualHashes).to.have.lengthOf(keyHashes.length);
      for(const hash of keyHashes) {
        expect(actualHashes).to.include(hash);
      }
    });

  });

  describe("activateKey(...)", function() {

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

    it("Should revert if tierPrice * duration has an overflow error.", async () => {
      const { keyManager, tierPrices } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Try to pass a tierPrice and duration that would result in an unsigned 256 bit overflow error:
      const tierId = 3;
      const tierPrice = tierPrices[tierId];
      expect(tierPrice).to.be.greaterThan(2); // ensure the multiplication will overflow
      const duration = ethers.BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"); // max 256 bit value
      try {
        await keyManager.activateKey(getRandomKeySet().keyHash, duration, tierId);
      } catch(err) {
        expect(err instanceof Error).to.be.true;
        if(err instanceof Error) {
          expect(err.message.match(/panic code 0x11 (.+) overflow/)).to.not.be.null;
        }
      }
    });

    it("Should take control of the full deposit balance from the controller.", async () => {
      const { keyManager, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Get starting balance of contract:
      const startingBalance = await erc20.balanceOf(keyManager.address);

      // Activate key with predetermined value:
      const tierId = 1;
      const tierPrice = tierPrices[tierId];
      const duration = 100;
      const payable = duration * tierPrice;
      expect(payable).to.be.greaterThan(0);
      await erc20.approve(keyManager.address, payable);
      await keyManager.activateKey(getRandomKeySet().keyHash, duration, tierId);

      // Get balance after deposit:
      const balanceAfter = await erc20.balanceOf(keyManager.address);
      expect(startingBalance.add(payable)).to.equal(balanceAfter);
    });

    it("Should NOT allow the activation of a key that already exists.", async () => {
      const { keyManager } = await loadFixture(deployAPIKeyManagerWithTiers);
      const { keyHash } = getRandomKeySet();
      await keyManager.activateKey(keyHash, 0, 0);
      await expect(keyManager.activateKey(keyHash, 0, 0)).to.be.rejectedWith("APIKM: key exists");
    });

    it("Should NOT allow the activation of a key with an archived tier.", async () => {
      const { keyManager } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Archive a tier:
      const tierId = 0;
      await keyManager.archiveTier(tierId);

      // Try to activate a key with that tier:
      await expect(keyManager.activateKey(getRandomKeySet().keyHash, 0, tierId)).to.be.rejectedWith("APIKM: inactive tier");
    });

    it("Should allow the activation of a key on a free tier without payment.", async () => {
      const { keyManager, erc20, tierPrices } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Get starting balance:
      const startingBalance = await erc20.balanceOf(keyManager.address);

      // Activate free-tier key:
      const { keyHash } = getRandomKeySet();
      const tierId = 0;
      expect(tierPrices[tierId]).to.equal(0);
      await expect(keyManager.activateKey(keyHash, 0, tierId)).to.not.be.rejected;

      // Check if balance is the same:
      expect(await erc20.balanceOf(keyManager.address)).to.equal(startingBalance);
    });

    it("Should set the proper key information on activation.", async () => {
      const { keyManager, owner } = await loadFixture(deployAPIKeyManagerWithTiers);
      const tierId = 0;
      const duration = 100;
      const { keyHash } = getRandomKeySet();
      const res = await (await keyManager.activateKey(keyHash, duration, tierId)).wait();
      const blockTimestamp = (await keyManager.provider.getBlock(res.blockNumber)).timestamp;
      const keyInfo = await keyManager.keyInfo(keyHash);
      expect(keyInfo.startTime).to.equal(blockTimestamp);
      expect(keyInfo.realizationTime).to.equal(blockTimestamp);
      expect(keyInfo.expiryTime).to.equal(blockTimestamp + duration);
      expect(keyInfo.tierId).to.equal(tierId);
      expect(keyInfo.owner).to.equal(owner.address);
    });

    it("Should emit an accurate ActivateKey event.", async () => {
      const { keyManager, owner } = await loadFixture(deployAPIKeyManagerWithTiers);
      const tierId = 0;
      const duration = 100;
      const { keyHash } = getRandomKeySet();
      await expect(keyManager.connect(owner).activateKey(keyHash, duration, tierId)).to.emit(keyManager, "ActivateKey").withArgs(keyHash, owner.address, duration);
    });

  });

  describe("extendKey(...)", async function() {

    it("Should allow the owner of a key to extend its duration", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);
      
      // Deploy Key:
      const keyDuration = 1000 * 60 * 60; // 1 hour
      const tierId = 0;
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], keyDuration, tierId);

      // Get expiry:
      const lastExpiry = (await keyManager.keyInfo(keyHash)).expiryTime;

      // Extend duration:
      const addedDuration = 1000 * 60 * 30; // 30 min
      const payable = ethers.BigNumber.from(tierPrices[tierId]).mul(addedDuration);
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, payable)).wait();
      await (await keyManager.connect(otherAccounts[0]).extendKey(keyHash, addedDuration)).wait();
      expect((await keyManager.keyInfo(keyHash)).expiryTime).to.equal(lastExpiry.add(addedDuration));
    });

    it("Should NOT allow an extension to a key that does not exist", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Try to extend duration:
      const { keyHash } = getRandomKeySet();
      const addedDuration = 1000 * 60 * 30; // 30 min
      const payable = ethers.BigNumber.from(tierPrices[0]).mul(addedDuration);
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, payable)).wait();
      await expect(keyManager.connect(otherAccounts[0]).extendKey(keyHash, addedDuration)).to.be.revertedWith("APIKM: key does not exist");
    });

    it("Should NOT allow an extension from a signer that is not owner.", async () => {
      const { keyManager, otherAccounts } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Activate new key:
      const activationSigner = otherAccounts[0];
      const { keyHash } = await activateRandomKey(keyManager, activationSigner, 100, 0);

      // Try to extend the key from another account:
      const extensionSigner = otherAccounts[1];
      expect(activationSigner.address).to.not.equal(extensionSigner.address);
      await expect(keyManager.connect(extensionSigner).extendKey(keyHash, 100)).to.be.rejectedWith("APIKM: not owner");
    });

    it("Should NOT allow an extension to a key that is in an archived tier.", async () => {
      const { keyManager, owner, otherAccounts } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Activate new key:
      const tierId = 0;
      const controller = otherAccounts[0];
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

      // Archive tier:
      await keyManager.connect(owner).archiveTier(tierId);

      // Try to extend the key:
      await expect(keyManager.connect(controller).extendKey(keyHash, 100)).to.be.rejectedWith("APIKM: inactive tier");
    });

    it("Should allow the extension of a free-tier key.", async () => {
      const { keyManager, otherAccounts, tierPrices } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Activate new free-tier key:
      const tierId = 0;
      expect(tierPrices[tierId]).to.equal(0);
      const controller = otherAccounts[0];
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

      // Extend the key:
      await expect(keyManager.connect(controller).extendKey(keyHash, 100)).to.not.be.rejected;
    });

    it("Should realize any used balance when reactivating an expired key or extending an active key.", async () => {

    });

    it("Should emit an ExtendKey event when extending while the key is still active.", async () => {
      const { keyManager, otherAccounts } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Activate new key:
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], 100, 0);

      // Extend key:
      const duration = 100;
      const tx = await extendKey(keyManager, otherAccounts[0], keyHash, duration);
      await expect(tx).to.emit(keyManager, "ExtendKey").withArgs(keyHash, duration);
    });

    it("Should emit a ReactivateKey event when extending after the key has expired.", async () => {
      const { keyManager, otherAccounts } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Activate new key:
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], 1, 0);

      // Wait for key to expire:
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
      });

      // Extend key:
      const duration = 100;
      const tx = await extendKey(keyManager, otherAccounts[0], keyHash, duration);
      await expect(tx).to.emit(keyManager, "ReactivateKey").withArgs(keyHash, duration);
    });
  });

  describe("deactivateKey(...)", function() {});

  describe("addTier(...)", function() {});

  describe("archiveTier(...)", function() {});

  describe("unrealizedProfit()", function() {});
  
  describe("findUnrealizedAccounts(...)", function() {});

  describe("withdraw()", function() {

    it("Should reject if there is nothing to withdraw.", async () => {
      const { keyManager, owner } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Try to withdraw zero balance:
      expect(await keyManager.realizedProfit()).to.equal(0);
      await expect(keyManager.connect(owner).withdraw()).to.be.rejectedWith("APIKM: no profit");
    });

    it("Should not allow a withdrawal from an address that is not owner", async () => {
      const { keyManager, otherAccounts } = await loadFixture(deployAPIKeyManagerWithTiers);
      await expect(keyManager.connect(otherAccounts[0]).withdraw()).to.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should reset the realized profit value on the contract.", async () => {
      const { keyManager, otherAccounts, tierPrices } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Ensure that current realized profit is zero:
      expect(await keyManager.realizedProfit()).to.equal(0);

      // Activate key:
      const tierId = 1;
      const duration = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], duration, tierId);

      // Wait for key to expire, then realize key value:
      await new Promise<void>((resolve) => {
        setTimeout(resolve, duration * 1000);
      });
      await keyManager.realizeProfit(keyHash);
      expect(await keyManager.realizedProfit()).to.be.greaterThan(0);

      // Withdraw and check if realized profit was reset:
      await keyManager.withdraw();
      expect(await keyManager.realizedProfit()).to.equal(0);
    });

    it("Should withdraw the full realized profit amount.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

      // Activate key:
      const tierId = 3;
      const duration = 2;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], duration, tierId);

      // Wait for key to expire, then realize key value:
      await new Promise<void>((resolve) => {
        setTimeout(resolve, duration * 1000);
      });
      await keyManager.realizeProfit(keyHash);
      const realizedProfit = await keyManager.realizedProfit();
      expect(realizedProfit).to.be.greaterThan(0);

      // Withdraw and check if realized profit was transferred:
      const balanceBefore = await erc20.balanceOf(owner.address);
      await keyManager.withdraw();
      expect(await erc20.balanceOf(owner.address)).to.equal(balanceBefore.add(realizedProfit));
    });

    // it("Should withdraw an amount equal to the amount of seconds passed since the last withdrawal per key multiplied by the tier price.", async () => {
    //   const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

    //   // Calculate payable amount:
    //   const tierId = 1;
    //   expect(tierPrices[tierId]).to.be.greaterThan(0);
    //   const keyDuration = 60; // 1 min
    //   const payable = ethers.BigNumber.from(keyDuration).mul(tierPrices[tierId]);
    //   expect(payable).to.be.greaterThan(0);

    //   // Activate the key:
    //   const controller = otherAccounts[0];
    //   const { keyHash } = getRandomKeySet();
    //   await erc20.connect(controller).approve(keyManager.address, payable);
    //   const activateRes = await keyManager.connect(controller).activateKey(keyHash, keyDuration, tierId);
    //   const activateTimestamp = (await keyManager.provider.getBlock((await activateRes.wait()).blockNumber)).timestamp;

    //   // Wait for 2 seconds:
    //   await new Promise((resolve) => {
    //     setTimeout(resolve, 2000);
    //   });

    //   // Get owner balance before withdrawal:
    //   const ownerBalanceBefore = await erc20.balanceOf(owner.address);

    //   // Withdraw the used key balance:
    //   const withdrawRes = await keyManager.connect(owner).withdrawUsedBalances([keyHash]);
    //   const withdrawTimestamp = (await keyManager.provider.getBlock((await withdrawRes.wait()).blockNumber)).timestamp;
      
    //   // Calculate the withdrawn amount:
    //   const activeDuration = withdrawTimestamp - activateTimestamp;
    //   const expectedWithdrawal = ethers.BigNumber.from(activeDuration).mul(tierPrices[tierId]);

    //   // Check if it matches the actual amount withdrawn:
    //   const ownerBalanceAfter = await erc20.balanceOf(owner.address);
    //   expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(expectedWithdrawal);
    // });

    // it("Should withdraw the full amount originally deposited for a key when it is expired.", async () => {
    //   const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

    //   // Calculate payable amount:
    //   const tierId = 1;
    //   expect(tierPrices[tierId]).to.be.greaterThan(0);
    //   const keyDuration = 2; // 2 seconds
    //   const payable = ethers.BigNumber.from(keyDuration).mul(tierPrices[tierId]);
    //   expect(payable).to.be.greaterThan(0);

    //   // Activate the key:
    //   const controller = otherAccounts[0];
    //   const { keyHash } = getRandomKeySet();
    //   await erc20.connect(controller).approve(keyManager.address, payable);
    //   await keyManager.connect(controller).activateKey(keyHash, keyDuration, tierId);

    //   // Wait for 1 second more than the key duration:
    //   await new Promise((resolve) => {
    //     setTimeout(resolve, 1000 * (keyDuration + 1));
    //   });

    //   // Get owner balance before withdrawal:
    //   const ownerBalanceBefore = await erc20.balanceOf(owner.address);

    //   // Withdraw the used key balance:
    //   await keyManager.connect(owner).withdrawUsedBalances([keyHash]);

    //   // Check if payable amount matches the actual amount withdrawn:
    //   const ownerBalanceAfter = await erc20.balanceOf(owner.address);
    //   expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(payable);
    // });

    // it("Should withdraw the full amount originally deposited for a key when withdrawing multiple times over and beyond the key's lifetime.", async () => {
    //   const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await loadFixture(deployAPIKeyManagerWithTiers);

    //   // Calculate payable amount:
    //   const tierId = 1;
    //   expect(tierPrices[tierId]).to.be.greaterThan(0);
    //   const keyDuration = 5; // 5 seconds
    //   const payable = ethers.BigNumber.from(keyDuration).mul(tierPrices[tierId]);
    //   expect(payable).to.be.greaterThan(0);

    //   // Activate the key:
    //   const controller = otherAccounts[0];
    //   const { keyHash } = getRandomKeySet();
    //   await erc20.connect(controller).approve(keyManager.address, payable);
    //   await keyManager.connect(controller).activateKey(keyHash, keyDuration, tierId);
    //   const localTxTime = Date.now();

    //   // Get owner balance before withdrawal:
    //   const ownerBalanceBefore = await erc20.balanceOf(owner.address);

    //   // Withdraw repeatedly until key is expired:
    //   const expiry = localTxTime + keyDuration * 1000;
    //   let withdrawals = 0;
    //   while(Date.now() < expiry) {
    //     try {
    //       await keyManager.connect(owner).withdrawUsedBalances([keyHash]);
    //       withdrawals++;
    //     } catch(err) {
    //       if(err instanceof Error && err.message.match("APIKM: no balance")) {
    //         break;
    //       } else {
    //         throw err;
    //       }
    //     }
    //   }
    //   expect(withdrawals).to.be.greaterThan(1);
    //   expect(await keyManager.isKeyActive(keyHash)).to.be.false;

    //   // Check if payable amount matches the total amount withdrawn:
    //   const ownerBalanceAfter = await erc20.balanceOf(owner.address);
    //   expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(payable);
    // });

  });

});