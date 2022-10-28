import { ethers } from "hardhat";

if(!process.env["DEPLOY_KEY"]) {
  throw new Error("Missing DEPLOY_KEY environment variable!");
}

const erc20Address = process.env["ERC20"];
if(!erc20Address) {
  throw new Error("Missing ERC20 environment variable!");
}

const deployAPIKeyManager = async () => {
  console.log("Deploying APIKeyManager contract...");
  const APIKeyManager = await ethers.getContractFactory("APIKeyManager");
  const keyManager = await APIKeyManager.deploy(erc20Address);
  await keyManager.deployed();
  return { keyManager };
};

const main = async () => {
  const { keyManager } = await deployAPIKeyManager();
  console.log("Deployed APIKeyManager to:", keyManager.address);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});