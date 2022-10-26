import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { APIKeyManager, TestERC20 } from "../typechain-types";
import type { Signer, ContractTransaction } from "ethers";
import type { Provider } from "@ethersproject/abstract-provider";

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
    const res = await loadFixture(deployAPIKeyManager);
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
  const txTimestamp = async (tx: ContractTransaction, provider: Provider) => {
    return (await provider.getBlock((await tx.wait()).blockNumber)).timestamp;
  };
  const waitSec = async (sec: number) => {
    await network.provider.send("evm_increaseTime", [sec]);
    await network.provider.send("evm_mine");
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

  describe("[helper] waitSec(...)", function() {
    it("Should simulate waiting X seconds before the next block is mined.", async () => {
      const { erc20, owner, otherAccounts } = await loadFixture(deployAPIKeyManager);
      for(let duration = 1; duration < 20; duration ++) {
        const tx1 = await txTimestamp(await erc20.connect(owner).transfer(otherAccounts[0].address, 1), erc20.provider);
        await waitSec(duration);
        const tx2 = await txTimestamp(await erc20.connect(owner).transfer(otherAccounts[0].address, 1), erc20.provider);
        expect(tx2 - duration).to.be.gte(tx1);
      }
    });
  });

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

  describe("realizeProfit(...)", function() {

    it("Should reject if key does not exist.", async () => {
      const { keyManager } = await loadFixture(deployAPIKeyManager);
      const { keyHash } = getRandomKeySet();
      await expect(keyManager.realizeProfit(keyHash)).to.be.rejectedWith("APIKM: key does not exist");
    });

    it("Should add the realized profit to the current balance.", async () => {
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      
      // Activate key:
      let tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash, tx } = await activateRandomKey(keyManager, controller, 100, tierId);
      let lastRealization = await txTimestamp(tx, keyManager.provider);

      // Realize multiple times and ensure that the balance is added each time:
      let lastBalance = await keyManager.realizedProfit();
      for(let i = 0; i < 5; i++) {
        await waitSec(1);
        const rTX = await keyManager.connect(controller).realizeProfit(keyHash);
        const timestamp = await txTimestamp(rTX, keyManager.provider);
        const duration = timestamp - lastRealization;
        const expectedIncrease = ethers.BigNumber.from(tierPrices[tierId]).mul(duration);
        const newBalance = await keyManager.realizedProfit();
        expect(newBalance).to.equal(lastBalance.add(expectedIncrease));
        lastBalance = newBalance;
        lastRealization = timestamp;
      }
    });

    it("Should allow a signer that is not owner of the key or contract to realize profit.", async () => {
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      const notController = otherAccounts[1];

      // Activate key:
      let tierId = 2;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

      // Wait 2 sec:
      await waitSec(2);
      
      // Realize profit from signer that is not controller:
      await expect(keyManager.connect(notController).realizeProfit(keyHash)).to.not.be.rejected;
    });

  });

  describe("keyInfo(...)", function() {

    it("Should return the correct info for a key.", async () => {
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      for(let i = 0; i < 20; i++) {
        const tierId = Math.floor(Math.random() * tierPrices.length);
        const duration = Math.floor(Math.random() * 100) + 1;
        const controller = otherAccounts[Math.floor(Math.random() * otherAccounts.length)];
        const { keyHash, tx } = await activateRandomKey(keyManager, controller, duration, tierId);
        const txTime = await txTimestamp(tx, keyManager.provider);
        const keyInfo = await keyManager.keyInfo(keyHash);
        expect(keyInfo.startTime).to.equal(txTime);
        expect(keyInfo.expiryTime).to.equal(txTime + duration);
        expect(keyInfo.realizationTime).to.equal(txTime);
        expect(keyInfo.owner).to.equal(controller.address);
        expect(keyInfo.tierId).to.equal(tierId);
      }
    });

    it("Should reject if the key does not exist.", async () => {
      const { keyManager } = await loadFixture(deployAPIKeyManager);
      const { keyHash } = getRandomKeySet();
      await expect(keyManager.keyInfo(keyHash)).to.be.rejectedWith("APIKM: key does not exist");
    });

  });

  describe("keyHashOf(...)", function() {

    it("Should return the correct keyHash.", async () => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();
      let lastKeyHash = "";
      for(let i = 0; i < 10; i++) {
        const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], 100, 0);
        expect(await keyManager.keyHashOf(i)).to.equal(keyHash);
        if(i > 0) {
          expect(await keyManager.keyHashOf(i - 1)).to.equal(lastKeyHash);
        }
        lastKeyHash = keyHash;
      }
    });

    it("Should reject if keyId does not exist.", async () => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();
      for(let i = 0; i < 10; i++) {
        const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], 100, 0);
        expect(await keyManager.keyHashOf(i)).to.equal(keyHash);
        expect(await keyManager.numKeys()).to.equal(i + 1);

        // Try to fetch key hash from ID that has not been created yet:
        await expect(keyManager.keyHashOf(i + 1)).to.be.rejectedWith("APIKM: nonexistent keyId");
      }
    });

  });

  describe("keyHashesOf(...)", function() {
    this.timeout(1000 * 1000);

    it("Should return an empty array for a controller with no keys.", async () => {
      const { keyManager, otherAccounts } = await loadFixture(deployAPIKeyManager);
      expect(await keyManager.keyHashesOf(otherAccounts[0].address)).to.have.lengthOf(0);
    });

    it("Should return an array containing only the keys for one controller.", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();
      
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
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();

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
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();
      
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
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();

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
      const { keyManager, tierPrices } = await deployAPIKeyManagerWithTiers();

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
      const { keyManager, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();

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
      const { keyManager } = await deployAPIKeyManagerWithTiers();
      const { keyHash } = getRandomKeySet();
      await keyManager.activateKey(keyHash, 0, 0);
      await expect(keyManager.activateKey(keyHash, 0, 0)).to.be.rejectedWith("APIKM: key exists");
    });

    it("Should NOT allow the activation of a key with an archived tier.", async () => {
      const { keyManager } = await deployAPIKeyManagerWithTiers();

      // Archive a tier:
      const tierId = 0;
      await keyManager.archiveTier(tierId);

      // Try to activate a key with that tier:
      await expect(keyManager.activateKey(getRandomKeySet().keyHash, 0, tierId)).to.be.rejectedWith("APIKM: inactive tier");
    });

    it("Should allow the activation of a key on a free tier without payment.", async () => {
      const { keyManager, erc20, tierPrices } = await deployAPIKeyManagerWithTiers();

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
      const { keyManager, owner } = await deployAPIKeyManagerWithTiers();
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
      const { keyManager, owner } = await deployAPIKeyManagerWithTiers();
      const tierId = 0;
      const duration = 100;
      const { keyHash } = getRandomKeySet();
      await expect(keyManager.connect(owner).activateKey(keyHash, duration, tierId)).to.emit(keyManager, "ActivateKey").withArgs(keyHash, owner.address, duration);
    });

  });

  describe("extendKey(...)", async function() {

    it("Should allow the owner of a key to extend its duration", async () => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();
      
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
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();

      // Try to extend duration:
      const { keyHash } = getRandomKeySet();
      const addedDuration = 1000 * 60 * 30; // 30 min
      const payable = ethers.BigNumber.from(tierPrices[0]).mul(addedDuration);
      await (await erc20.connect(otherAccounts[0]).approve(keyManager.address, payable)).wait();
      await expect(keyManager.connect(otherAccounts[0]).extendKey(keyHash, addedDuration)).to.be.revertedWith("APIKM: key does not exist");
    });

    it("Should NOT allow an extension from a signer that is not owner.", async () => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();

      // Activate new key:
      const activationSigner = otherAccounts[0];
      const { keyHash } = await activateRandomKey(keyManager, activationSigner, 100, 0);

      // Try to extend the key from another account:
      const extensionSigner = otherAccounts[1];
      expect(activationSigner.address).to.not.equal(extensionSigner.address);
      await expect(keyManager.connect(extensionSigner).extendKey(keyHash, 100)).to.be.rejectedWith("APIKM: not owner");
    });

    it("Should NOT allow an extension to a key that is in an archived tier.", async () => {
      const { keyManager, owner, otherAccounts } = await deployAPIKeyManagerWithTiers();

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
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();

      // Activate new free-tier key:
      const tierId = 0;
      expect(tierPrices[tierId]).to.equal(0);
      const controller = otherAccounts[0];
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

      // Extend the key:
      await expect(keyManager.connect(controller).extendKey(keyHash, 100)).to.not.be.rejected;
    });

    it("Should realize any used balance when reactivating an expired key or extending an active key.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      for(let tierId = 0; tierId < tierPrices.length; tierId++) {
        // Activate a new key:
        const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

        // Wait 1 sec:
        await waitSec(1);

        // Expect realized profit to be zero:
        expect(await keyManager.realizedProfit()).to.equal(0);

        // Extend Key and check realized profit:
        await extendKey(keyManager, controller, keyHash, 100);
        if(tierPrices[tierId] > 0) {
          expect(await keyManager.realizedProfit()).to.be.greaterThan(0);

          // Withdraw to reset realized profit:
          await keyManager.connect(owner).withdraw();
        } else {
          expect(await keyManager.realizedProfit()).to.equal(0);
        }
      }
    });

    it("Should allow the extension of a deactivated key.", async () => {
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      for(let tierId = 0; tierId < tierPrices.length; tierId++) {
        // Activate a new key:
        const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

        // Deactivate key:
        await keyManager.connect(controller).deactivateKey(keyHash);

        // Check if it was deactivated:
        expect(await keyManager.isKeyActive(keyHash)).to.be.false;

        // Extend Key:
        await extendKey(keyManager, controller, keyHash, 100);
        expect(await keyManager.isKeyActive(keyHash)).to.be.true;
      }
    });

    it("Should emit an ExtendKey event when extending while the key is still active.", async () => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();

      // Activate new key:
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], 100, 0);

      // Extend key:
      const duration = 100;
      const tx = await extendKey(keyManager, otherAccounts[0], keyHash, duration);
      await expect(tx).to.emit(keyManager, "ExtendKey").withArgs(keyHash, duration);
    });

    it("Should emit a ReactivateKey event when extending after the key has expired.", async () => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();

      // Activate new key:
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], 1, 0);

      // Wait for key to expire:
      await waitSec(1);

      // Extend key:
      const duration = 100;
      const tx = await extendKey(keyManager, otherAccounts[0], keyHash, duration);
      await expect(tx).to.emit(keyManager, "ReactivateKey").withArgs(keyHash, duration);
    });
  });

  describe("deactivateKey(...)", function() {

    it("Should deactivate an active key.", async() => {
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      for(let tierId = 0; tierId < tierPrices.length; tierId++) {
        // Activate a new key:
        const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

        // Ensure key is active:
        expect(await keyManager.isKeyActive(keyHash)).to.be.true;

        // Deactivate key:
        await keyManager.connect(controller).deactivateKey(keyHash);

        // Check if it was deactivated:
        expect(await keyManager.isKeyActive(keyHash)).to.be.false;
      }
    });

    it("Should reject when deactivating a non-existent key.", async() => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      const { keyHash } = getRandomKeySet();

      // Ensure key does not exist:
      expect(await keyManager.keyExists(keyHash)).to.be.false;

      // Try to deactivate key:
      await expect(keyManager.connect(controller).deactivateKey(keyHash)).to.be.rejectedWith("APIKM: key does not exist");
    });

    it("Should reject when deactivating an expired key.", async() => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];

      // Activate and deactivate a new key:
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, 0);
      await keyManager.connect(controller).deactivateKey(keyHash);

      // Ensure key is not active:
      expect(await keyManager.isKeyActive(keyHash)).to.be.false;

      // Try to deactivate key again:
      await expect(keyManager.connect(controller).deactivateKey(keyHash)).to.be.rejectedWith("APIKM: key not active");
    });

    it("Should reject when deactivating a key that is not owned.", async() => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      const notController = otherAccounts[1];

      // Activate a new key:
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, 0);

      // Try to deactivate key from another signer:
      await expect(keyManager.connect(notController).deactivateKey(keyHash)).to.be.rejectedWith("APIKM: not owner");
    });

    it("Should emit a transfer event if funds are transferred.", async() => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];

      // Activate a new key:
      const tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

      // Deactivate key:
      expect(keyManager.connect(controller).deactivateKey(keyHash)).to.emit(erc20.address, "Transfer");
    });

    it("Should NOT emit a transfer event if there are no funds to transfer.", async() => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];

      // Activate a new key:
      const tierId = 0;
      expect(tierPrices[tierId]).to.equal(0);
      const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

      // Deactivate key:
      expect(keyManager.connect(controller).deactivateKey(keyHash)).to.not.emit(erc20.address, "Transfer");
    });

    it("Should emit a deactivation event if successful.", async() => {
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];
      for(let tierId = 0; tierId < tierPrices.length; tierId++) {
        // Activate a new key:
        const { keyHash } = await activateRandomKey(keyManager, controller, 100, tierId);

        // Deactivate key:
        expect(keyManager.connect(controller).deactivateKey(keyHash)).to.emit(keyManager.address, "DeactivateKey").withArgs(keyHash);
      }
    });

    it("Should transfer unused funds back to the owner and realize the rest as profit.", async() => {
      const { keyManager, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();
      const controller = otherAccounts[0];

      // Activate a new key:
      const tierId = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const duration = 100;
      const { keyHash, tx } = await activateRandomKey(keyManager, controller, duration, tierId);
      const activationTime = await txTimestamp(tx, keyManager.provider);

      // Wait 2 sec:
      const waitTime = 2;
      await waitSec(waitTime);

      // Deactivate key and find transferred amount:
      expect(await keyManager.realizedProfit()).to.equal(0);
      const balanceBefore = await erc20.balanceOf(controller.address);
      const deactivateTX = await keyManager.connect(controller).deactivateKey(keyHash);
      const deactivationTime = await txTimestamp(deactivateTX, keyManager.provider);
      const timeActive = deactivationTime - activationTime;
      const balanceAfter = await erc20.balanceOf(controller.address);
      const expectedTransfer = ethers.BigNumber.from(duration - timeActive).mul(tierPrices[tierId]);
      const expectedRealized = ethers.BigNumber.from(timeActive).mul(tierPrices[tierId]);
      expect(expectedTransfer).to.be.greaterThan(0);
      expect(expectedTransfer.add(balanceBefore)).to.equal(balanceAfter);
      expect(await keyManager.realizedProfit()).to.equal(expectedRealized);
    });

  });

  describe("addTier(...)", function() {

    it("Should allow the contract owner to add a new tier.", async () => {
      const { keyManager, owner } = await loadFixture(deployAPIKeyManager);
      expect(await keyManager.numTiers()).to.equal(0);
      for(let i = 0; i < 20; i++) {
        const price = i * 2;
        await expect(keyManager.connect(owner).addTier(price)).to.not.be.rejected;
        expect(await keyManager.connect(owner).tierPrice(i)).to.equal(price);
      }
    });

    it("Should NOT allow an address that is not contract owner to add a new tier.", async () => {
      const { keyManager, owner, otherAccounts } = await loadFixture(deployAPIKeyManager);
      for(let i = 0; i < otherAccounts.length; i++) {
        const account = otherAccounts[i];
        expect(account.address).to.not.equal(owner.address);
        await expect(keyManager.connect(account).addTier(i)).to.be.rejectedWith("Ownable: caller is not the owner");
      }
    });

    it("Should activate the next tierId.", async () => {
      const { keyManager, owner } = await loadFixture(deployAPIKeyManager);
      for(let i = 0; i < 10; i++) {
        const price = 0;
        await keyManager.connect(owner).addTier(price);
        expect(await keyManager.isTierActive(i)).to.be.true;
        await expect(keyManager.isTierActive(i + 1)).to.be.rejectedWith("APIKM: tier does not exist");
      }
    });

    it("Should emit a tier addition event.", async () => {
      const { keyManager, owner } = await loadFixture(deployAPIKeyManager);
      for(let i = 0; i < 10; i++) {
        const price = i + 1;
        expect(keyManager.connect(owner).addTier(price)).to.emit(keyManager.address, "AddTier").withArgs(i, price);
      }
    });

  });

  describe("archiveTier(...)", function() {

    it("Should allow the contract owner to archive a tier.", async () => {
      const { keyManager, owner } = await deployAPIKeyManagerWithTiers();
      const numTiers = (await keyManager.numTiers()).toNumber();
      for(let i = 0; i < numTiers; i++) {
        expect(await keyManager.isTierActive(i)).to.be.true;
        await keyManager.connect(owner).archiveTier(i);
        expect(await keyManager.isTierActive(i)).to.be.false;
      }
    });

    it("Should NOT allow an address that is not contract owner to archive a tier.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();
      for(let i = 0; i < otherAccounts.length; i++) {
        const account = otherAccounts[i];
        expect(account.address).to.not.equal(owner.address);
        await expect(keyManager.connect(account).archiveTier(Math.floor(Math.random() * tierPrices.length))).to.be.rejectedWith("Ownable: caller is not the owner");
      }
    });

    it("Should reject if tier does not exist.", async () => {
      const { keyManager, owner, tierPrices } = await deployAPIKeyManagerWithTiers();
      expect(tierPrices.length).to.equal(await keyManager.numTiers());
      await expect(keyManager.connect(owner).archiveTier(tierPrices.length)).to.be.rejectedWith("APIKM: tier does not exist");
    });

    it("Should emit a tier archive event.", async () => {
      const { keyManager, owner } = await deployAPIKeyManagerWithTiers();
      const numTiers = await keyManager.numTiers();
      for(let i = 0; numTiers.gt(i); i++) {
        expect(keyManager.connect(owner).archiveTier(i)).to.emit(keyManager.address, "ArchiveTier").withArgs(i);
      }
    });

  });

  describe("unrealizedProfit()", function() {
    this.timeout(10000);

    it("Should be zero at contract initialization.", async () => {
      const { keyManager } = await deployAPIKeyManagerWithTiers();
      expect(await keyManager.unrealizedProfit()).to.equal(0);
    });

    it("Should return the unrealized profit locked in the contract.", async () => {
      const { keyManager, otherAccounts, erc20, tierPrices } = await deployAPIKeyManagerWithTiers();

      // Activate a bunch of keys with long durations:
      let keyHashes: string[] = [];
      let totalDeposited = 0;
      const duration = 2;
      const numKeys = 10;
      const receipts: Promise<any>[] = [];
      for(let i = 0; i < numKeys; i++) {
        const tierId = Math.floor(Math.random() * (tierPrices.length - 1)) + 1;
        expect(tierPrices[tierId]).to.be.greaterThan(0);
        const { keyHash, tx } = await activateRandomKey(keyManager, otherAccounts[0], duration, tierId);
        receipts.push(tx.wait());
        totalDeposited += duration * tierPrices[tierId];
        keyHashes.push(keyHash);
      }
      await Promise.all(receipts);
      expect(keyHashes.length).to.equal(numKeys);
      expect(await keyManager.numKeys()).to.equal(numKeys);

      // Wait for keys to expire:
      await waitSec(duration);

      // Check that unrealized profit is the same as total contract balance;
      const initialUnrealized = await keyManager.unrealizedProfit();
      const balance = await erc20.balanceOf(keyManager.address);
      expect(balance).to.equal(totalDeposited);
      expect(initialUnrealized).to.equal(balance);

      // Realize profit:
      for(const keyHash of keyHashes) {
        await keyManager.realizeProfit(keyHash);
      }

      // Check that unrealized profit has reduced as that contract balance is equal to realized + unrealized profit:
      const remainingUnrealized = await keyManager.unrealizedProfit();
      expect(remainingUnrealized).to.equal(0);
      expect(remainingUnrealized.add(await keyManager.realizedProfit())).to.equal(await erc20.balanceOf(keyManager.address));
    });

  });
  
  describe("findUnrealizedAccounts(...)", function() {});

  describe("withdraw()", function() {

    it("Should reject if there is nothing to withdraw.", async () => {
      const { keyManager, owner } = await deployAPIKeyManagerWithTiers();

      // Try to withdraw zero balance:
      expect(await keyManager.realizedProfit()).to.equal(0);
      await expect(keyManager.connect(owner).withdraw()).to.be.rejectedWith("APIKM: no profit");
    });

    it("Should NOT allow a withdrawal from an address that is not owner", async () => {
      const { keyManager, otherAccounts } = await deployAPIKeyManagerWithTiers();
      await expect(keyManager.connect(otherAccounts[0]).withdraw()).to.be.rejectedWith("Ownable: caller is not the owner");
    });

    it("Should reset the realized profit value on the contract.", async () => {
      const { keyManager, otherAccounts, tierPrices } = await deployAPIKeyManagerWithTiers();

      // Ensure that current realized profit is zero:
      expect(await keyManager.realizedProfit()).to.equal(0);

      // Activate key:
      const tierId = 1;
      const duration = 1;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], duration, tierId);

      // Wait for key to expire, then realize key value:
      await waitSec(duration);
      await keyManager.realizeProfit(keyHash);
      expect(await keyManager.realizedProfit()).to.be.greaterThan(0);

      // Withdraw and check if realized profit was reset:
      await keyManager.withdraw();
      expect(await keyManager.realizedProfit()).to.equal(0);
    });

    it("Should withdraw the full realized profit amount.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();

      // Activate key:
      const tierId = 3;
      const duration = 2;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], duration, tierId);

      // Wait for key to expire, then realize key value:
      await waitSec(duration);
      await keyManager.realizeProfit(keyHash);
      const realizedProfit = await keyManager.realizedProfit();
      expect(realizedProfit).to.be.greaterThan(0);

      // Withdraw and check if realized profit was transferred:
      const balanceBefore = await erc20.balanceOf(owner.address);
      await keyManager.withdraw();
      expect(await erc20.balanceOf(owner.address)).to.equal(balanceBefore.add(realizedProfit));
    });

    it("Should emit a withdrawal event.", async () => {
      const { keyManager, owner, otherAccounts, tierPrices, erc20 } = await deployAPIKeyManagerWithTiers();

      // Activate key:
      const tierId = 3;
      const duration = 2;
      expect(tierPrices[tierId]).to.be.greaterThan(0);
      const { keyHash } = await activateRandomKey(keyManager, otherAccounts[0], duration, tierId);

      // Wait for key to expire, then realize key value:
      await waitSec(duration);
      await keyManager.realizeProfit(keyHash);
      const realizedProfit = await keyManager.realizedProfit();
      expect(realizedProfit).to.be.greaterThan(0);

      // Withdraw and check if the event was emitted:
      expect(keyManager.withdraw()).to.emit(keyManager.address, "Withdraw").withArgs(owner.address, realizedProfit);
    });

  });

});