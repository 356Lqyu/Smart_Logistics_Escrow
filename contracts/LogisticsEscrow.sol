// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LogisticsEscrow {

    // =====================================================
    // USER REGISTRATION
    // =====================================================

    enum UserRole {
        None,
        Shipper,
        Carrier
    }

    struct User {
        string name;
        UserRole role;
        bool registered;
    }

    mapping(address => User) public users;

    event UserRegistered(
        address indexed user,
        UserRole role
    );

    // =====================================================
    // AGREEMENT
    // =====================================================

    enum AgreementStatus {
        Created,
        InProgress,
        Completed,
        Cancelled,
        Expired
    }

    enum Priority {
        Normal,
        Express,
        Urgent
    }

    struct Milestone {
        string checkpoint;
        uint percentage;

        // Carrier submitted completion.
        bool completed;

        // Shipper verified completion.
        bool verified;

        // ETH for this milestone was released.
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

        // Total escrow originally deposited.
        uint escrowAmount;

        // Remaining escrow currently locked.
        uint escrowRemaining;

        uint deadline;
        uint createdTime;
        Priority priority;
        AgreementStatus status;

        // Only this milestone can currently be submitted/verified.
        uint currentMilestone;
    }

    uint public agreementCounter;

    mapping(uint => Agreement) private agreements;
    mapping(uint => Milestone[]) public agreementMilestones;
    mapping(bytes32 => bool) private agreementHashes;

    // =====================================================
    // EVENTS
    // =====================================================

    event AgreementCreated(
        uint indexed agreementId,
        string referenceNo,
        address indexed shipper,
        uint escrowAmount
    );

    event EscrowFunded(
        uint indexed agreementId,
        uint amount
    );

    event AgreementAccepted(
        uint indexed agreementId,
        address indexed carrier
    );

    event MilestoneCompletionSubmitted(
        uint indexed agreementId,
        uint indexed milestoneIndex,
        address indexed carrier
    );

    event MilestoneVerified(
        uint indexed agreementId,
        uint indexed milestoneIndex,
        address indexed shipper,
        uint amount
    );

    event MilestonePayout(
        uint indexed agreementId,
        uint indexed milestoneIndex,
        address indexed carrier,
        uint amount
    );

    event MilestoneRejected(
        uint indexed agreementId,
        uint indexed milestoneIndex,
        address indexed shipper,
        string reason
    );

    event AgreementCompleted(
        uint indexed agreementId
    );

    event AgreementCancelled(
        uint indexed agreementId
    );

    event AgreementExpired(
        uint indexed agreementId
    );

    event EscrowRefunded(
        uint indexed agreementId,
        address indexed shipper,
        uint amount
    );

    // =====================================================
    // USER REGISTRATION
    // =====================================================

    function register(
        string memory _name,
        UserRole _role
    ) external {
        require(
            !users[msg.sender].registered,
            "Wallet already registered"
        );

        require(
            bytes(_name).length > 0,
            "Name is required"
        );

        require(
            _role == UserRole.Shipper ||
            _role == UserRole.Carrier,
            "Invalid role"
        );

        users[msg.sender] = User({
            name: _name,
            role: _role,
            registered: true
        });

        emit UserRegistered(
            msg.sender,
            _role
        );
    }

    // =====================================================
    // VIEW AGREEMENT
    // =====================================================

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

    function getMilestoneCount(uint agreementId)
        external
        view
        returns (uint)
    {
        return agreementMilestones[agreementId].length;
    }

    function getMilestone(
        uint agreementId,
        uint index
    )
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
        require(
            index < agreementMilestones[agreementId].length,
            "Milestone does not exist"
        );

        Milestone storage m =
            agreementMilestones[agreementId][index];

        return (
            m.checkpoint,
            m.percentage,
            m.completed,
            m.verified,
            m.paid,
            m.completedAt,
            m.verifiedAt
        );
    }

    // =====================================================
    // CREATE + AUTO-FUND AGREEMENT
    //
    // The shipper creates the agreement and sends the
    // complete escrow amount in the SAME transaction.
    //
    // New state:
    // Created = created + funded + waiting for carrier.
    // =====================================================

    function createAgreement(
        string memory shipmentDetails,
        uint payloadValue,
        uint escrowAmount,
        uint deadline,
        Priority priority,
        string[] memory checkpoints,
        uint[] memory percentages
    )
        public
        payable
        returns (uint256)
    {
        require(
            escrowAmount >= 0.01 ether,
            "Minimum escrow is 0.01 ETH"
        );

        require(
            msg.value == escrowAmount,
            "ETH sent must equal escrow amount"
        );

        require(
            deadline > block.timestamp,
            "Invalid deadline"
        );

        require(
            checkpoints.length == percentages.length,
            "Invalid milestones"
        );

        require(
            checkpoints.length == 3,
            "Exactly three milestones required"
        );

        require(
            percentages[0] == 30 &&
            percentages[1] == 30 &&
            percentages[2] == 40,
            "Milestones must be 30%, 30%, 40%"
        );

        require(
            payloadValue > 0,
            "Payload value must be greater than zero"
        );

        require(
            bytes(shipmentDetails).length > 0,
            "Shipment details required"
        );

        uint total = 0;

        for (uint i = 0; i < percentages.length; i++) {
            require(
                percentages[i] > 0 &&
                percentages[i] <= 100,
                "Invalid milestone percentage"
            );

            total += percentages[i];
        }

        require(
            total == 100,
            "Percentages must equal 100"
        );

        bytes32 agreementHash =
            keccak256(
                abi.encodePacked(
                    msg.sender,
                    keccak256(bytes(shipmentDetails)),
                    payloadValue,
                    escrowAmount,
                    deadline
                )
            );

        require(
            !agreementHashes[agreementHash],
            "Duplicate agreement detected"
        );

        agreementHashes[agreementHash] = true;

        agreementCounter++;
        uint newId = agreementCounter;

        string memory refNo =
            _generateReferenceNo(newId);

        agreements[newId] = Agreement({
            agreementId: newId,
            referenceNo: refNo,
            shipper: payable(msg.sender),
            carrier: payable(address(0)),
            shipmentDetails: shipmentDetails,
            payloadValue: payloadValue,
            escrowAmount: escrowAmount,
            escrowRemaining: escrowAmount,
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

        emit AgreementCreated(
            newId,
            refNo,
            msg.sender,
            escrowAmount
        );

        // Kept as an explicit event for transaction history.
        emit EscrowFunded(
            newId,
            escrowAmount
        );

        return newId;
    }

    // =====================================================
    // REFERENCE NUMBER
    // =====================================================

    function _generateReferenceNo(uint id)
        internal
        pure
        returns (string memory)
    {
        string memory paddedId;

        if (id < 10) {
            paddedId = string(
                abi.encodePacked(
                    "000",
                    _uintToStr(id)
                )
            );
        } else if (id < 100) {
            paddedId = string(
                abi.encodePacked(
                    "00",
                    _uintToStr(id)
                )
            );
        } else if (id < 1000) {
            paddedId = string(
                abi.encodePacked(
                    "0",
                    _uintToStr(id)
                )
            );
        } else {
            paddedId = _uintToStr(id);
        }

        return string(
            abi.encodePacked(
                "LG-2026-",
                paddedId
            )
        );
    }

    function _uintToStr(uint _i)
        internal
        pure
        returns (string memory)
    {
        if (_i == 0) {
            return "0";
        }

        uint temp = _i;
        uint digits;

        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer =
            new bytes(digits);

        while (_i != 0) {
            digits--;

            buffer[digits] =
                bytes1(
                    uint8(
                        48 +
                        uint(_i % 10)
                    )
                );

            _i /= 10;
        }

        return string(buffer);
    }

    // =====================================================
    // ACCEPT AGREEMENT
    //
    // Created → InProgress
    //
    // Created already contains escrow because creation
    // automatically funded it.
    // =====================================================

    function acceptAgreement(
        uint agreementId
    )
        external
    {
        Agreement storage agreement =
            agreements[agreementId];

        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );

        require(
            agreement.status ==
                AgreementStatus.Created,
            "Agreement is not available for acceptance"
        );

        require(
            msg.sender != agreement.shipper,
            "Shipper cannot be carrier"
        );

        require(
            block.timestamp <=
                agreement.deadline,
            "Deadline passed"
        );

        require(
            agreement.escrowRemaining ==
                agreement.escrowAmount,
            "Escrow is not fully funded"
        );

        agreement.carrier =
            payable(msg.sender);

        agreement.status =
            AgreementStatus.InProgress;

        emit AgreementAccepted(
            agreementId,
            msg.sender
        );
    }

    // =====================================================
    // CARRIER SUBMITS CURRENT MILESTONE
    //
    // Pending:
    // completed=false, verified=false, paid=false
    //
    // After submission:
    // completed=true, verified=false, paid=false
    // =====================================================

    function submitMilestoneCompletion(
        uint agreementId
    )
        external
    {
        Agreement storage agreement =
            agreements[agreementId];

        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );

        require(
            agreement.status ==
                AgreementStatus.InProgress,
            "Agreement is not in progress"
        );

        require(
            msg.sender == agreement.carrier,
            "Only the carrier can submit completion"
        );

        require(
            block.timestamp <=
                agreement.deadline,
            "Agreement deadline has passed"
        );

        uint index =
            agreement.currentMilestone;

        require(
            index <
                agreementMilestones[agreementId].length,
            "All milestones are complete"
        );

        Milestone storage milestone =
            agreementMilestones[agreementId][index];

        require(
            !milestone.completed,
            "Milestone already submitted"
        );

        require(
            !milestone.verified,
            "Milestone already verified"
        );

        require(
            !milestone.paid,
            "Milestone already paid"
        );

        milestone.completed = true;
        milestone.completedAt =
            block.timestamp;

        emit MilestoneCompletionSubmitted(
            agreementId,
            index,
            msg.sender
        );
    }

    // =====================================================
    // SHIPPER VERIFIES + RELEASES PAYMENT
    //
    // completed=true
    // verified=false
    // paid=false
    //
    // becomes:
    // completed=true
    // verified=true
    // paid=true
    //
    // Then currentMilestone increments.
    // =====================================================

    function verifyMilestone(
        uint agreementId
    )
        external
    {
        Agreement storage agreement =
            agreements[agreementId];

        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );

        require(
            agreement.status ==
                AgreementStatus.InProgress,
            "Agreement is not in progress"
        );

        require(
            msg.sender == agreement.shipper,
            "Only the shipper can verify"
        );

        require(
            block.timestamp <=
                agreement.deadline,
            "Agreement deadline has passed"
        );

        uint index =
            agreement.currentMilestone;

        require(
            index <
                agreementMilestones[agreementId].length,
            "All milestones are complete"
        );

        Milestone storage milestone =
            agreementMilestones[agreementId][index];

        require(
            milestone.completed,
            "Carrier has not submitted completion"
        );

        require(
            !milestone.verified,
            "Milestone already verified"
        );

        require(
            !milestone.paid,
            "Milestone already paid"
        );

        require(
            agreement.escrowRemaining > 0,
            "Agreement has no remaining escrow"
        );

        uint payout =
            (
                agreement.escrowAmount *
                milestone.percentage
            ) / 100;

        require(
            payout > 0,
            "Invalid milestone payout"
        );

        require(
            agreement.escrowRemaining >= payout,
            "Insufficient escrow remaining"
        );

        // State is updated before the external call.
        // Re-entry is therefore unable to pay the same
        // milestone again through this function.
        milestone.verified = true;
        milestone.paid = true;
        milestone.verifiedAt =
            block.timestamp;

        agreement.escrowRemaining -= payout;

        agreement.currentMilestone++;

        (bool success,) =
            agreement.carrier.call{
                value: payout
            }("");

        require(
            success,
            "Payment transfer failed"
        );

        emit MilestoneVerified(
            agreementId,
            index,
            msg.sender,
            payout
        );

        emit MilestonePayout(
            agreementId,
            index,
            agreement.carrier,
            payout
        );

        if (
            agreement.currentMilestone >=
            agreementMilestones[agreementId].length
        ) {
            require(
                agreement.escrowRemaining == 0,
                "Escrow remains after final milestone"
            );

            agreement.status =
                AgreementStatus.Completed;

            emit AgreementCompleted(
                agreementId
            );
        }
    }

    function rejectMilestone(
        uint agreementId,
        string memory reason
    )
        external
    {
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

        // Reset completion status so carrier can re-submit
        milestone.completed = false;
        milestone.completedAt = 0;

        emit MilestoneRejected(
            agreementId,
            index,
            msg.sender,
            reason
        );
    }

    // =====================================================
    // CANCEL
    //
    // Only shipper.
    // Only before carrier acceptance.
    // Refunds the complete remaining escrow.
    // =====================================================

    function cancelAgreement(
        uint agreementId
    )
        external
    {
        Agreement storage agreement =
            agreements[agreementId];

        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );

        require(
            msg.sender == agreement.shipper,
            "Only shipper can cancel"
        );

        require(
            agreement.status ==
                AgreementStatus.Created,
            "Agreement cannot be cancelled"
        );

        uint amount =
            agreement.escrowRemaining;

        agreement.escrowRemaining = 0;
        agreement.escrowAmount = 0;

        agreement.status =
            AgreementStatus.Cancelled;

        if (amount > 0) {
            (bool success,) =
                agreement.shipper.call{
                    value: amount
                }("");

            require(
                success,
                "Refund failed"
            );

            emit EscrowRefunded(
                agreementId,
                agreement.shipper,
                amount
            );
        }

        emit AgreementCancelled(
            agreementId
        );
    }

    // =====================================================
    // EXPIRE
    //
    // Only the shipper may confirm expiry after the deadline.
    // Remaining escrow is refunded to that shipper.
    // =====================================================

    function expireAgreement(
        uint agreementId
    )
        external
    {
        Agreement storage agreement =
            agreements[agreementId];

        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );

        require(
            msg.sender == agreement.shipper,
            "Only the shipper can expire agreement"
        );

        require(
            block.timestamp >
                agreement.deadline,
            "Deadline not passed"
        );

        require(
            agreement.status ==
                AgreementStatus.Created ||
            agreement.status ==
                AgreementStatus.InProgress,
            "Cannot expire"
        );

        uint amount =
            agreement.escrowRemaining;

        agreement.escrowRemaining = 0;
        agreement.escrowAmount = 0;

        agreement.status =
            AgreementStatus.Expired;

        if (amount > 0) {
            (bool success,) =
                agreement.shipper.call{
                    value: amount
                }("");

            require(
                success,
                "Refund failed"
            );

            emit EscrowRefunded(
                agreementId,
                agreement.shipper,
                amount
            );
        }

        emit AgreementExpired(
            agreementId
        );
    }
}
