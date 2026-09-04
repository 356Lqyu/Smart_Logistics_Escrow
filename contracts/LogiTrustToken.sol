// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Minimal ERC-20 reputation token. Minting is restricted to `owner`,
// which is transferred to the LogisticsEscrow contract after deployment
// so only verified milestone completions can mint rewards.
contract LogiTrustToken {

    string public constant name = "LogiTrust Token";
    string public constant symbol = "LTT";
    uint8 public constant decimals = 18;

    uint public totalSupply;
    address public owner;

    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    event Transfer(address indexed from, address indexed to, uint value);
    event Approval(address indexed owner, address indexed spender, uint value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // Called by LogisticsEscrow when a carrier successfully
    // completes an agreement.
    function mintReward(address to, uint amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "Allowance exceeded");
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint amount) internal {
        require(to != address(0), "Invalid recipient");
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}