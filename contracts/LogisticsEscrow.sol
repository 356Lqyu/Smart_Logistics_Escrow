// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
interface ILogiTrustToken {
    function mintReward(address to, uint amount) external;
}

contract LogisticsEscrow {
    address public owner;
    ILogiTrustToken public rewardToken;

    uint public constant CARRIER_REWARD = 10 * 10 ** 18;
    uint public constant CARRIER_STAKE_PERCENTAGE = 30;
    uint private constant MAX_ACTIVE_AGREEMENTS_PER_CARRIER = 3;

    event CarrierRewarded(
        uint indexed agreementId,
        address indexed carrier,
        uint amount
    );

    constructor(address tokenAddress) {
        owner = msg.sender;
        rewardToken = ILogiTrustToken(tokenAddress);
    }

    enum UserRole { None, Shipper, Carrier }

    struct User {
        string name;
        UserRole role;
        bool registered;
    }

    mapping(address => User) public users;
    mapping(address => bytes) private profilePictures;

    event UserRegistered(address indexed user, UserRole role);
    event ProfilePictureUpdated(address indexed user);

    enum AgreementStatus { Created, InProgress, Completed, Cancelled, Expired }
    enum Priority { Normal, Express, Urgent }

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

    uint public agreementCounter;

    mapping(uint => Agreement) private agreements;
    mapping(uint => Milestone[]) public agreementMilestones;
    mapping(uint => mapping(uint => bytes32)) private milestoneProofHashes;
    mapping(bytes32 => bool) private agreementHashes;
    mapping(address => uint) private activeAgreementsByCarrier;
    mapping(address => uint) private lockedStakeByCarrier;

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

    function getCarrierLockedStake(address carrier) external view returns (uint) {
        return lockedStakeByCarrier[carrier];
    }

    function register(string memory _name, UserRole _role) external {
        require(!users[msg.sender].registered, "Wallet already registered");
        require(bytes(_name).length > 0, "Name is required");
        require(_role == UserRole.Shipper || _role == UserRole.Carrier, "Invalid role");

        users[msg.sender] = User({
            name: _name,
            role: _role,
            registered: true
        });

        emit UserRegistered(msg.sender, _role);
    }

    function setProfilePicture(bytes calldata data) external {
        require(users[msg.sender].registered, "Not registered");
        require(data.length > 0, "Empty image");
        require(data.length <= 65536, "Image too large after compression");

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
        Agreement storage a = agreements[id];
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
        require(index < agreementMilestones[agreementId].length, "Milestone does not exist");
        Milestone storage m = agreementMilestones[agreementId][index];
        return (m.checkpoint, m.percentage, m.completed, m.verified, m.paid, m.completedAt, m.verifiedAt);
    }

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
        require(escrowAmount >= 0.1 ether, "Minimum escrow is 0.1 ETH");
        require(msg.value == escrowAmount, "ETH sent must equal escrow amount");
        require(deadline > block.timestamp, "Invalid deadline");
        require(checkpoints.length == percentages.length, "Invalid milestones");
        require(checkpoints.length == 3, "Exactly three milestones required");
        require(percentages[0] == 30 && percentages[1] == 30 && percentages[2] == 40, "Milestones must be 30%, 30%, 40%");
        require(payloadValue > 0, "Payload value must be greater than zero");
        require(bytes(shipmentDetails).length > 0, "Shipment details required");

        uint total = 0;
        for (uint i = 0; i < percentages.length; i++) {
            require(percentages[i] > 0 && percentages[i] <= 100, "Invalid milestone percentage");
            total += percentages[i];
        }
        require(total == 100, "Percentages must equal 100");

        bytes32 agreementHash = keccak256(abi.encodePacked(msg.sender, keccak256(bytes(shipmentDetails)), payloadValue, escrowAmount, deadline));
        require(!agreementHashes[agreementHash], "Duplicate agreement detected");
        agreementHashes[agreementHash] = true;

        agreementCounter++;
        uint newId = agreementCounter;

        // Using external library function here:
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

    function acceptAgreement(uint agreementId) external payable {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(agreement.status == AgreementStatus.Created, "Agreement is not available for acceptance");
        require(msg.sender != agreement.shipper, "Shipper cannot be carrier");
        require(block.timestamp <= agreement.deadline, "Deadline passed");
        require(agreement.escrowRemaining == agreement.escrowAmount, "Escrow is not fully funded");
        require(
            activeAgreementsByCarrier[msg.sender] < MAX_ACTIVE_AGREEMENTS_PER_CARRIER,
            "Carrier already has 3 active agreements"
        );

        uint requiredStake = (agreement.escrowAmount * CARRIER_STAKE_PERCENTAGE) / 100;
        require(msg.value == requiredStake, "Carrier stake must equal 30% of escrow");

        agreement.carrier = payable(msg.sender);
        agreement.carrierStake = msg.value;
        agreement.status = AgreementStatus.InProgress;
        activeAgreementsByCarrier[msg.sender]++;
        lockedStakeByCarrier[msg.sender] += msg.value;

        emit AgreementAccepted(agreementId, msg.sender);
        emit CarrierStakeDeposited(agreementId, msg.sender, msg.value);
    }

    function submitMilestoneCompletion(uint agreementId, bytes32 proofHash) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(agreement.status == AgreementStatus.InProgress, "Agreement is not in progress");
        require(msg.sender == agreement.carrier, "Only the carrier can submit completion");
        require(block.timestamp <= agreement.deadline, "Agreement deadline has passed");

        uint index = agreement.currentMilestone;
        require(index < agreementMilestones[agreementId].length, "All milestones are complete");

        Milestone storage milestone = agreementMilestones[agreementId][index];
        require(!milestone.completed, "Milestone already submitted");
        require(!milestone.verified, "Milestone already verified");
        require(!milestone.paid, "Milestone already paid");
        require(proofHash != bytes32(0), "Invalid proof hash");

        milestone.completed = true;
        milestone.completedAt = block.timestamp;
        milestoneProofHashes[agreementId][index] = proofHash;

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

        uint payout = (agreement.escrowAmount * milestone.percentage) / 100;
        require(payout > 0, "Invalid milestone payout");
        require(agreement.escrowRemaining >= payout, "Insufficient escrow remaining");

        milestone.verified = true;
        milestone.paid = true;
        milestone.verifiedAt = block.timestamp;
        agreement.escrowRemaining -= payout;
        agreement.currentMilestone++;

        (bool success,) = agreement.carrier.call{value: payout}("");
        require(success, "Payment transfer failed");

        emit MilestoneVerified(agreementId, index, msg.sender, payout);
        emit MilestonePayout(agreementId, index, agreement.carrier, payout);

        if (agreement.currentMilestone >= agreementMilestones[agreementId].length) {
            require(agreement.escrowRemaining == 0, "Escrow remains after final milestone");
            agreement.status = AgreementStatus.Completed;
            activeAgreementsByCarrier[agreement.carrier]--;

            uint stake = agreement.carrierStake;
            agreement.carrierStake = 0;
            lockedStakeByCarrier[agreement.carrier] -= stake;

            emit AgreementCompleted(agreementId);

            if (stake > 0) {
                (bool stakeReturned,) = agreement.carrier.call{value: stake}("");
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

        uint index = agreement.currentMilestone;
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

    function expireAgreement(uint agreementId) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only the shipper can expire agreement");
        require(block.timestamp > agreement.deadline, "Deadline not passed");
        require(agreement.status == AgreementStatus.Created || agreement.status == AgreementStatus.InProgress, "Cannot expire");

        bool wasInProgress = agreement.status == AgreementStatus.InProgress;

        uint amount = agreement.escrowRemaining;
        uint forfeitedStake = agreement.carrierStake;
        agreement.escrowRemaining = 0;
        agreement.escrowAmount = 0;
        agreement.carrierStake = 0;
        agreement.status = AgreementStatus.Expired;

        if (wasInProgress) {
            activeAgreementsByCarrier[agreement.carrier]--;
            lockedStakeByCarrier[agreement.carrier] -= forfeitedStake;
        }

        uint totalToShipper = amount + forfeitedStake;
        if (totalToShipper > 0) {
            (bool success,) = agreement.shipper.call{value: totalToShipper}("");
            require(success, "Refund failed");
            if (amount > 0) emit EscrowRefunded(agreementId, agreement.shipper, amount);
            if (forfeitedStake > 0) emit CarrierStakeForfeited(agreementId, agreement.shipper, forfeitedStake);
        }

        emit AgreementExpired(agreementId);
    }

    function extendDeadline(uint agreementId, uint newDeadline) external {
        Agreement storage agreement = agreements[agreementId];
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only the shipper can extend deadline");
        require(agreement.status == AgreementStatus.Created || agreement.status == AgreementStatus.InProgress, "Cannot extend deadline for this agreement status");
        require(newDeadline > agreement.deadline, "New deadline must be greater than current deadline");

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

    function _uintToStr(uint _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }

        uint temp = _i;
        uint digits;

        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);

        while (_i != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint(_i % 10)));
            _i /= 10;
        }

        return string(buffer);
    }
}
