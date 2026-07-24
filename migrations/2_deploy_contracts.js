// enter solidity contract
var Animals  = artifacts.require("./SponsorAnimals.sol");
//var LaunchPad = artifacts.require("LaunchPad");
//var MyToken = artifacts.require("MyToken");
//var EmoToken = artifacts.require("EmoToken");

module.exports = function(deployer) {
  deployer.deploy(Animals);
};



// module.exports = function(deployer, network, accounts) {
//     deployer.deploy(LaunchPad, false, { from: accounts[0] }); //not lock the contract
//     deployer.deploy(MyToken, { from: accounts[1] }); //comment when deploy
//     deployer.deploy(EmoToken, { from: accounts[6] }); //comment when deploy
// }