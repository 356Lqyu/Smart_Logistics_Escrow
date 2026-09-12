// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
interface ILogiTrustToken {
    function mintReward(address to, uint amount) external;
}

contract LogisticsEscrow {
    address public owner;
    ILogiTrustToken public rewardToken;
    // uint for unsigned interger non-negative value
    uint public constant CARRIER_REWARD = 10 * 10 ** 18;
    uint public constant CARRIER_STAKE_PERCENTAGE = 30;
    uint private constant MAX_ACTIVE_AGREEMENTS_PER_CARRIER = 3;
    uint public agreementCounter;

    // records important action on blockchain
    event CarrierRewarded(uint indexed agreementId,address indexed carrier,uint amount);
    
    // only once when LogisticsEscrow is deployed.
    constructor(address tokenAddress) {
        owner = msg.sender;
        rewardToken = ILogiTrustToken(tokenAddress);
    }

    enum UserRole { None, Shipper, Carrier }
    enum AgreementStatus { Created, InProgress, Completed, Cancelled, Expired }
    enum Priority { Normal, Express, Urgent }
    struct User {
        string name;
        UserRole role;
        bool registered;
    }
    struct Milestone {
        string checkpoint;
        uint percentage;
        bool completed;
        bool verified;
        bool paid;
        uint completedAt;
        uint verifiedAt;
    }
    struct Agreement {
        uint agreementId;
        string referenceNo;
        address payable shipper;
        address payable carrier;
        string shipmentDetails;
        uint payloadValue;
        uint escrowAmount;
        uint escrowRemaining;
        uint carrierStake;
        uint deadline;
        uint createdTime;
        Priority priority;
        AgreementStatus status;
        uint currentMilestone;
    }

    //store and retrieve contract data
    // Stores each registered user’s details using their wallet address
    mapping(address => User) public users;
    mapping(address => bytes) private profilePictures;
    mapping(uint => Agreement) private agreements;
    // Stores the list of milestones belonging to each agreement
    mapping(uint => Milestone[]) private agreementMilestones;
    mapping(uint => mapping(uint => bytes32)) private milestoneProofHashes;
    mapping(bytes32 => bool) private agreementHashes;
    mapping(address => uint) private activeAgreementsByCarrier;
    mapping(address => uint) private lockedStakeByCarrier;

    // create a blockchain transaction log for important user, agreement and escrow actions
    event UserRegistered(address indexed user, UserRole role);
    // Records that the user’s profile picture was updated, it does not store the picture inside the event
    event ProfilePictureUpdated(address indexed user);
    event AgreementCreated(uint indexed agreementId, string referenceNo, address indexed shipper, uint escrowAmount);
    event EscrowFunded(uint indexed agreementId, uint amount);
    event AgreementAccepted(uint indexed agreementId, address indexed carrier);
    event CarrierStakeDeposited(uint indexed agreementId, address indexed carrier, uint amount);
    event CarrierStakeReturned(uint indexed agreementId, address indexed carrier, uint amount);
    event CarrierStakeForfeited(uint indexed agreementId, address indexed shipper, uint amount);
    event MilestoneCompletionSubmitted(uint indexed agreementId, uint indexed milestoneIndex, address indexed carrier, bytes32 proofHash);
    event MilestoneVerified(uint indexed agreementId, uint indexed milestoneIndex, address indexed shipper, uint amount);
    event MilestonePayout(uint indexed agreementId, uint indexed milestoneIndex, address indexed carrier, uint amount);
    event MilestoneRejected(uint indexed agreementId, uint indexed milestoneIndex, address indexed shipper, string reason);
    event AgreementCompleted(uint indexed agreementId);
    event AgreementCancelled(uint indexed agreementId);
    event AgreementExpired(uint indexed agreementId);
    event EscrowRefunded(uint indexed agreementId, address indexed shipper, uint amount);
    event DeadlineExtended(uint indexed agreementId, uint newDeadline, address indexed shipper);

    // retrieves the total performance stake currently locked by a Carrier
    function getCarrierLockedStake(address carrier) external view returns (uint) {
        return lockedStakeByCarrier[carrier];
    }

    // register new user (memory for temporary data storage during the function call)
    function register(string memory _name, UserRole _role) external {
        require(!users[msg.sender].registered, "Wallet already registered");
        require(bytes(_name).length > 0, "Name is required");
        require(_role == UserRole.Shipper || _role == UserRole.Carrier, "Invalid role");
        // Creates and stores the user record using their wallet address as the key
        users[msg.sender] = User({
            name: _name,
            role: _role,
            registered: true
        });
        // Records a UserRegistered event on the blockchain
        emit UserRegistered(msg.sender, _role);
    }

    // allows a registered user to save or update their profile picture directly on the blockchain
    function setProfilePicture(bytes calldata data) external {
        require(users[msg.sender].registered, "Not registered");
        require(data.length > 0, "Empty image");
        require(data.length <= 65536, "Image too large after compression");
        // Stores the image bytes using the user’s wallet address
        profilePictures[msg.sender] = data;
        emit ProfilePictureUpdated(msg.sender);
    }

    function getProfilePicture(address user) external view returns (bytes memory) {
        return profilePictures[user];
    }

    function getAgreementBasic(uint id)
        external
        view
        returns (
            uint agreementId,
            string memory referenceNo,
            address shipper,
            address carrier,
            uint escrowAmount,
            uint escrowRemaining,
            uint deadline,
            Priority priority,
            AgreementStatus status,
            uint currentMilestone
        )
    {
        Agreement storage a = agreements[id];   //creates a reference named a pointing to the agreement stored under that ID
        return (
            a.agreementId,
            a.referenceNo,
            a.shipper,
            a.carrier,
            a.escrowAmount,
            a.escrowRemaining,
            a.deadline,
            a.priority,
            a.status,
            a.currentMilestone
        );
    }

    function getMilestoneCount(uint agreementId) external view returns (uint) {
        return agreementMilestones[agreementId].length;
    }

    function getMilestone(uint agreementId, uint index)
        external
        view
        returns (
            string memory checkpoint,
            uint percentage,
            bool completed,
            bool verified,
            bool paid,
            uint completedAt,
            uint verifiedAt
        )
    {
        require(index < agreementMilestones[agreementId].length, "Milestone does not exist"); //prevents the function from requesting a milestone outside the agreement’s list
        Milestone storage m = agreementMilestones[agreementId][index];  // reference to the milestone already stored in blockchain storage
        return (m.checkpoint, m.percentage, m.completed, m.verified, m.paid, m.completedAt, m.verifiedAt);
    }

    // retrieves the hash stored for that agreement and milestone
    function getMilestoneProofHash(uint agreementId, uint index) external view returns (bytes32) {
        require(index < agreementMilestones[agreementId].length, "Milestone does not exist");
        return milestoneProofHashes[agreementId][index];
    }

    function createAgreement(
        string memory shipmentDetails,
        uint payloadValue,
        uint escrowAmount,
        uint deadline,
        Priority priority,
        string[] memory checkpoints,
        uint[] memory percentages
    ) public payable returns (uint256) {
        require(users[msg.sender].role == UserRole.Shipper,"Only registered shippers can create agreements");
        require(escrowAmount > 0, "Escrow amount must be greater than 0");
        require(msg.value == escrowAmount, "ETH sent must equal escrow amount");
        require(deadline > block.timestamp, "Invalid deadline");
        require(checkpoints.length == percentages.length, "Invalid milestones");
        require(checkpoints.length == 3, "Exactly three milestones required");
        require(percentages[0] == 30 && percentages[1] == 30 && percentages[2] == 40, "Milestones must be 30%, 30%, 40%");
        require(payloadValue > 0, "Payload value must be greater than zero");
        require(bytes(shipmentDetails).length > 0, "Shipment details required");

        // checks that every percentage is valid and calculates the total
        uint total = 0;
        for (uint i = 0; i < percentages.length; i++) {
            require(percentages[i] > 0 && percentages[i] <= 100, "Invalid milestone percentage");
            total += percentages[i];
        }
        require(total == 100, "Percentages must equal 100");

        // creates a unique hash based on the Shipper, shipment details, payload value, escrow amount and deadline
        bytes32 agreementHash = keccak256(abi.encodePacked(msg.sender, keccak256(bytes(shipmentDetails)), payloadValue, escrowAmount, deadline));
        require(!agreementHashes[agreementHash], "Duplicate agreement detected");
        agreementHashes[agreementHash] = true;

        agreementCounter++;
        uint newId = agreementCounter;

        string memory refNo = generateReferenceNo(newId);

        agreements[newId] = Agreement({
            agreementId: newId,
            referenceNo: refNo,
            shipper: payable(msg.sender),
            carrier: payable(address(0)),
            shipmentDetails: shipmentDetails,
            payloadValue: payloadValue,
            escrowAmount: escrowAmount,
            escrowRemaining: escrowAmount,
            carrierStake: 0,
            deadline: deadline,
            createdTime: block.timestamp,
            priority: priority,
            status: AgreementStatus.Created,
            currentMilestone: 0
        });

        for (uint i = 0; i < checkpoints.length; i++) {
            agreementMilestones[newId].push(
                Milestone({
                    checkpoint: checkpoints[i],
                    percentage: percentages[i],
                    completed: false,
                    verified: false,
                    paid: false,
                    completedAt: 0,
                    verifiedAt: 0
                })
            );
        }

        emit AgreementCreated(newId, refNo, msg.sender, escrowAmount);
        emit EscrowFunded(newId, escrowAmount);

        return newId;
    }

    // allows a registered Carrier to accept an available agreement by depositing a performance stake.
    function acceptAgreement(uint agreementId) external payable {
        // Creates agreement as a reference to the agreement stored on the blockchain.
        Agreement storage agreement = agreements[agreementId];
        require(users[msg.sender].role == UserRole.Carrier,"Only registered carriers can accept agreements");
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(agreement.status == AgreementStatus.Created, "Agreement is not available for acceptance");
        require(msg.sender != agreement.shipper, "Shipper cannot be carrier");
        require(block.timestamp <= agreement.deadline, "Deadline passed");
        require(agreement.escrowRemaining == agreement.escrowAmount, "Escrow is not fully funded");
        require(
            activeAgreementsByCarrier[msg.sender] < MAX_ACTIVE_AGREEMENTS_PER_CARRIER,
            "Carrier already has 3 active agreements"
        );

        // Calculate the required stake
        uint requiredStake = (agreement.escrowAmount * CARRIER_STAKE_PERCENTAGE) / 100;
        require(msg.value == requiredStake, "Carrier stake must equal 30% of escrow");
        // Assigns the Carrier’s wallet address to the agreement.
        agreement.carrier = payable(msg.sender);
        // Stores the Carrier’s deposited stake
        agreement.carrierStake = msg.value; 
        agreement.status = AgreementStatus.InProgress;
        // Increases the Carrier’s number of active agreements by one
        activeAgreementsByCarrier[msg.sender]++;
        // Adds the stake to the Carrier’s total locked stake
        lockedStakeByCarrier[msg.sender] += msg.value;

        emit AgreementAccepted(agreementId, msg.sender);
        emit CarrierStakeDeposited(agreementId, msg.sender, msg.value);
    }

    // allows the assigned Carrier to submit completion evidence for the current milestone
    // proofHash is 32-byte hash of the completion evidence
    function submitMilestoneCompletion(uint agreementId, bytes32 proofHash) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(agreement.status == AgreementStatus.InProgress, "Agreement is not in progress");
        require(msg.sender == agreement.carrier, "Only the carrier can submit completion");
        require(block.timestamp <= agreement.deadline, "Agreement deadline has passed");

        // Gets the milestone currently awaiting completion
        uint index = agreement.currentMilestone;
        require(index < agreementMilestones[agreementId].length, "All milestones are complete");

        Milestone storage milestone = agreementMilestones[agreementId][index];
        require(!milestone.completed, "Milestone already submitted");
        require(!milestone.verified, "Milestone already verified");
        require(!milestone.paid, "Milestone already paid");
        require(proofHash != bytes32(0), "Invalid proof hash");  // Rejects an empty or zero hash.

        milestone.completed = true;
        milestone.completedAt = block.timestamp;
        milestoneProofHashes[agreementId][index] = proofHash;  // Stores the proof hash for this agreement and milestone

        emit MilestoneCompletionSubmitted(agreementId, index, msg.sender, proofHash);
    }

    function verifyMilestone(uint agreementId) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(agreement.status == AgreementStatus.InProgress, "Agreement is not in progress");
        require(msg.sender == agreement.shipper, "Only the shipper can verify");
        require(block.timestamp <= agreement.deadline, "Agreement deadline has passed");

        uint index = agreement.currentMilestone;
        require(index < agreementMilestones[agreementId].length, "All milestones are complete");

        Milestone storage milestone = agreementMilestones[agreementId][index];
        require(milestone.completed, "Carrier has not submitted completion");
        require(!milestone.verified, "Milestone already verified");
        require(!milestone.paid, "Milestone already paid");
        require(agreement.escrowRemaining > 0, "Agreement has no remaining escrow");

        // Calculate the payout
        uint payout = index == agreementMilestones[agreementId].length - 1
            ? agreement.escrowRemaining
            : (agreement.escrowAmount * milestone.percentage) / 100;
        require(payout > 0, "Invalid milestone payout");
        require(agreement.escrowRemaining >= payout, "Insufficient escrow remaining");

        milestone.verified = true;
        milestone.paid = true;
        milestone.verifiedAt = block.timestamp;
        agreement.escrowRemaining -= payout;
        agreement.currentMilestone++;

        // Transfers the milestone payment to the Carrier
        (bool success,) = agreement.carrier.call{value: payout}("");
        require(success, "Payment transfer failed");

        emit MilestoneVerified(agreementId, index, msg.sender, payout);
        emit MilestonePayout(agreementId, index, agreement.carrier, payout);

        // Checks whether all milestones have been completed
        if (agreement.currentMilestone >= agreementMilestones[agreementId].length) {
            require(agreement.escrowRemaining == 0, "Escrow remains after final milestone");
            agreement.status = AgreementStatus.Completed;
            activeAgreementsByCarrier[agreement.carrier]--;

            // Retrieves the Carrier’s locked stake and removes it from the locked-stake records
            uint stake = agreement.carrierStake;
            agreement.carrierStake = 0;
            lockedStakeByCarrier[agreement.carrier] -= stake;

            emit AgreementCompleted(agreementId);

            if (stake > 0) {
                (bool stakeReturned,) = agreement.carrier.call{value: stake}("");  //Returns the performance stake to the Carrier
                require(stakeReturned, "Stake return failed");
                emit CarrierStakeReturned(agreementId, agreement.carrier, stake);
            }

            rewardToken.mintReward(agreement.carrier, CARRIER_REWARD);
            emit CarrierRewarded(agreementId, agreement.carrier, CARRIER_REWARD);
        }
    }

    function rejectMilestone(uint agreementId, string memory reason) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(agreement.status == AgreementStatus.InProgress, "Agreement is not in progress");
        require(msg.sender == agreement.shipper, "Only the shipper can reject milestones");
        require(block.timestamp <= agreement.deadline, "Agreement deadline has passed");
        require(bytes(reason).length > 0,"Rejection reason is required");

        uint index = agreement.currentMilestone;
        require(index < agreementMilestones[agreementId].length,"All milestones are complete");
        Milestone storage milestone = agreementMilestones[agreementId][index];
        require(milestone.completed, "Milestone has not been submitted");
        require(!milestone.verified, "Milestone already verified");
        require(!milestone.paid, "Milestone already paid");

        milestone.completed = false;
        milestone.completedAt = 0;
        delete milestoneProofHashes[agreementId][index];

        emit MilestoneRejected(agreementId, index, msg.sender, reason);
    }

    function cancelAgreement(uint agreementId) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only shipper can cancel");
        require(agreement.status == AgreementStatus.Created, "Agreement cannot be cancelled");

        uint amount = agreement.escrowRemaining;
        agreement.escrowRemaining = 0;
        agreement.escrowAmount = 0;
        agreement.status = AgreementStatus.Cancelled;

        if (amount > 0) {
            (bool success,) = agreement.shipper.call{value: amount}("");
            require(success, "Refund failed");
            emit EscrowRefunded(agreementId, agreement.shipper, amount);
        }

        emit AgreementCancelled(agreementId);
    }

    // expires an agreement after its deadline and refunds the appropriate funds to the Shipper
    // not need payable because it sends existing contract funds
    function expireAgreement(uint agreementId) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only the shipper can expire agreement");
        require(block.timestamp > agreement.deadline, "Deadline not passed");
        require(agreement.status == AgreementStatus.Created || agreement.status == AgreementStatus.InProgress, "Cannot expire");

        bool wasInProgress = agreement.status == AgreementStatus.InProgress;

        // Save refund amounts
        uint amount = agreement.escrowRemaining;
        uint forfeitedStake = agreement.carrierStake;
        agreement.escrowRemaining = 0;
        agreement.escrowAmount = 0;
        agreement.carrierStake = 0;
        agreement.status = AgreementStatus.Expired;

        // If a Carrier had accepted the agreement: their active-agreement count decreases and ocked stake total decreases
        if (wasInProgress) {
            activeAgreementsByCarrier[agreement.carrier]--;
            lockedStakeByCarrier[agreement.carrier] -= forfeitedStake;
        }

        uint totalToShipper = amount + forfeitedStake;
        // Transfers the combined refund to the Shipper
        if (totalToShipper > 0) {
            (bool success,) = agreement.shipper.call{value: totalToShipper}("");
            require(success, "Refund failed");
            if (amount > 0) emit EscrowRefunded(agreementId, agreement.shipper, amount);
            if (forfeitedStake > 0) emit CarrierStakeForfeited(agreementId, agreement.shipper, forfeitedStake);
        }

        emit AgreementExpired(agreementId);
    }

    // allows the Shipper to extend the deadline of an active agreement
    function extendDeadline(uint agreementId, uint newDeadline) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only the shipper can extend deadline");   
        require(agreement.status == AgreementStatus.InProgress,"Agreement is not in progress");        
        require(block.timestamp <= agreement.deadline,"Current deadline has already passed");
        require(newDeadline > agreement.deadline, "New deadline must be greater than current deadline");

        // Replaces the old deadline with the new deadline in blockchain storage
        agreement.deadline = newDeadline;
        emit DeadlineExtended(agreementId, newDeadline, msg.sender);
    }

    function generateReferenceNo(uint id) internal pure returns (string memory) {
        string memory paddedId;

        if (id < 10) {
            paddedId = string(abi.encodePacked("000", _uintToStr(id)));
        } else if (id < 100) {
            paddedId = string(abi.encodePacked("00", _uintToStr(id)));
        } else if (id < 1000) {
            paddedId = string(abi.encodePacked("0", _uintToStr(id)));
        } else {
            paddedId = _uintToStr(id);
        }

        return string(abi.encodePacked("LG-2026-", paddedId));
    }

    // converts an unsigned integer into a normal decimal string
    // pure means it does not read or modify blockchain state, returns a temporary string in memory
    function _uintToStr(uint _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }

        uint temp = _i;
        uint digits;

        // Repeatedly divides the number by 10 until it becomes zero.
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        // Creates enough space to store the decimal characters
        bytes memory buffer = new bytes(digits);

        while (_i != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint(_i % 10)));
            _i /= 10;
        }

        return string(buffer);
    }
}
