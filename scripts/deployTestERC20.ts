import { ethers } from "hardhat";

const deployTestERC20 = async () => {
  console.log("Deploying TestERC20 contract...");
  const TestERC20 = await ethers.getContractFactory("TestERC20");
  const erc20 = await TestERC20.deploy();
  await erc20.deployed();
  return erc20;
};

const main = async () => {
  const testERC20 = await deployTestERC20();
  console.log("Deployed TestERC20 to:", testERC20.address);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});