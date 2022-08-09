import { ethers } from "hardhat";

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

const main = async () => {
  const { keyManager } = await deployAPIKeyManager();
  console.log("Deployed APIKeyManager to:", keyManager.address);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
