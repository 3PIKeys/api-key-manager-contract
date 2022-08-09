import { ethers } from "hardhat";

async function main() {
  const erc20Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const APIKeyManager = await ethers.getContractFactory("APIKeyManager");
  const keyManager = await APIKeyManager.deploy(erc20Address);
  await keyManager.deployed();
  console.log("Deployed APIKeyManager to:", keyManager.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
