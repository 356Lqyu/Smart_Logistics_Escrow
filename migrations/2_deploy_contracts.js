const LogisticsEscrow = artifacts.require("LogisticsEscrow");
const LogiTrustToken = artifacts.require("LogiTrustToken");

module.exports = async function (deployer) {
    await deployer.deploy(LogiTrustToken);
    const token = await LogiTrustToken.deployed();

    await deployer.deploy(LogisticsEscrow, token.address);
    const escrow = await LogisticsEscrow.deployed();

    // LogisticsEscrow is the only account allowed to mint LTT rewards.
    await token.transferOwnership(escrow.address);
};