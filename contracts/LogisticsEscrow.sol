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
    // AGREEMENT ENUMS
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


    // =====================================================
    // MILESTONE
    // =====================================================

    struct Milestone {
        string checkpoint;
        uint percentage;
        bool completed;
        bool verified;
        bool paid;
    }


    // =====================================================
    // AGREEMENT
    // =====================================================
    struct Agreement {
        uint agreementId;
        string referenceNo;
        address payable shipper;
        address payable carrier;
        uint escrowAmount;
        uint escrowReleased;
        uint deadline;
        uint createdTime;
        Priority priority;
        AgreementStatus status;
        uint currentMilestone;
    }


    // =====================================================
    // STORAGE
    // =====================================================

    uint public agreementCounter;

    mapping(uint => Agreement) private agreements;

    mapping(uint => Milestone[]) public agreementMilestones;

    mapping(bytes32 => bool) private agreementHashes;


    // =====================================================
    // EVENTS
    // =====================================================

    event AgreementCreated(
        uint agreementId,
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

    event AgreementCompleted(
        uint indexed agreementId
    );

    event AgreementCancelled(
        uint indexed agreementId
    );

    event AgreementExpired(
        uint indexed agreementId
    );

    event MilestoneCompleted(
        uint indexed agreementId,
        uint milestoneIndex,
        address indexed carrier
    );

    event MilestoneVerified(
        uint indexed agreementId,
        uint milestoneIndex,
        address indexed shipper
    );

    event MilestonePaid(
        uint indexed agreementId,
        uint milestoneIndex,
        address indexed carrier,
        uint amount
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
    )
        external
    {

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
    // VIEW USER
    // =====================================================

    function getUser(address user)
        external
        view
        returns (
            string memory name,
            UserRole role,
            bool registered
        )
    {
        User storage u = users[user];
        return (
            u.name,
            u.role,
            u.registered
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
            uint escrowReleased,
            uint escrowRemaining,
            uint deadline,
            uint createdTime,
            Priority priority,
            AgreementStatus status,
            uint currentMilestone
        )
    {
        Agreement storage a = agreements[id];

        uint remaining = 0;

        if (a.escrowAmount > a.escrowReleased) {
            remaining =
                a.escrowAmount -
                a.escrowReleased;
        }

        return (
            a.agreementId,
            a.referenceNo,
            a.shipper,
            a.carrier,
            a.escrowAmount,
            a.escrowReleased,
            remaining,
            a.deadline,
            a.createdTime,
            a.priority,
            a.status,
            a.currentMilestone
        );
    }


    // =====================================================
    // CREATE AGREEMENT
    //
    // Shipment details, origin, destination and payload
    // value are stored in Supabase rather than blockchain.
    //
    // Blockchain stores only information required for
    // escrow execution and agreement identification.
    // =====================================================

    function createAgreement(
        uint deadline,
        Priority priority,
        string[] memory checkpoints,
        uint[] memory percentages
    )
        public
        payable
        returns(uint256)
    {
        require(
            msg.value >= 0.01 ether,
            "Minimum escrow is 0.01 ETH"
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
            checkpoints.length > 0,
            "At least one milestone required"
        );


        // =================================================
        // Validate milestone percentages
        // =================================================

        uint total = 0;

        for (
            uint i = 0;
            i < percentages.length;
            i++
        ) {

            require(
                percentages[i] > 0,
                "Milestone percentage must be greater than zero"
            );

            total += percentages[i];
        }

        require(
            total == 100,
            "Percentages must equal 100"
        );


        // =================================================
        // Duplicate agreement check
        // =================================================

        bytes32 agreementHash =
            keccak256(
                abi.encodePacked(
                    msg.sender,
                    msg.value,
                    deadline,
                    block.timestamp
                )
            );

        require(
            !agreementHashes[agreementHash],
            "Duplicate agreement detected"
        );

        agreementHashes[agreementHash] = true;


        // =================================================
        // Generate agreement ID
        // =================================================

        agreementCounter++;

        uint newId = agreementCounter;


        // =================================================
        // Generate reference number
        // =================================================

        string memory refNo =
            _generateReferenceNo(newId);


        // =================================================
        // Store agreement
        // =================================================

        agreements[newId] = Agreement({
            agreementId: newId,
            referenceNo: refNo,
            shipper: payable(msg.sender),
            carrier: payable(address(0)),
            escrowAmount: msg.value,
            escrowReleased: 0,
            deadline: deadline,
            createdTime: block.timestamp,
            priority: priority,
            status: AgreementStatus.Created,
            currentMilestone: 0
        });


        // =================================================
        // Store milestones
        // =================================================

        for (
            uint i = 0;
            i < checkpoints.length;
            i++
        ) {

            agreementMilestones[newId].push(

                Milestone({
                    checkpoint: checkpoints[i],
                    percentage: percentages[i],
                    completed: false,
                    verified: false,
                    paid: false
                })
            );
        }


        // =================================================
        // Events
        // =================================================

        emit AgreementCreated(
            newId,refNo,msg.sender,msg.value
        );

        emit EscrowFunded(
            newId, msg.value
        );

        return newId;
    }


    // =====================================================
    // GENERATE REFERENCE NUMBER
    // =====================================================

    function _generateReferenceNo(uint id)
        internal
        pure
        returns(string memory)
    {

        string memory paddedId;

        if(id < 10){

            paddedId =
                string(
                    abi.encodePacked("000", _uintToStr(id) )
                );
        }
        else if(id < 100){

            paddedId =
                string(
                    abi.encodePacked( "00", _uintToStr(id))
                );
        }
        else if(id < 1000){

            paddedId =
                string(
                    abi.encodePacked("0", _uintToStr(id))
                );
        }
        else{
            paddedId = _uintToStr(id);
        }

        return
            string(
                abi.encodePacked("LG-2026-",paddedId)
            );
    }


    function _uintToStr(uint _i)
        internal
        pure
        returns(string memory)
    {

        if(_i == 0){
            return "0";
        }

        uint temp = _i;
        uint digits;

        while(temp != 0){
            digits++;
            temp /= 10;
        }

        bytes memory buffer =
            new bytes(digits);


        while(_i != 0){
            digits--;
            buffer[digits] =
                bytes1(
                    uint8( 48 + uint(_i % 10) )
                );

            _i /= 10;
        }


        return string(buffer);
    }

    // =====================================================
    // ACCEPT AGREEMENT
    //
    // Created to InProgress
    // =====================================================

    function acceptAgreement(
        uint agreementId
    )
        external
    {

        Agreement storage agreement = agreements[agreementId];

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
            users[msg.sender].registered,
            "Carrier is not registered"
        );

        require(
            users[msg.sender].role ==
                UserRole.Carrier,
            "Only Carrier can accept"
        );

        require(
            block.timestamp <=
            agreement.deadline,
            "Deadline passed"
        );

        agreement.carrier = payable(msg.sender);
        agreement.status = AgreementStatus.InProgress;

        emit AgreementAccepted(
            agreementId,
            msg.sender
        );
    }


    // =====================================================
    // COMPLETE MILESTONE
    //
    // Carrier marks the milestone as completed.
    // This does NOT release payment yet.
    // =====================================================

    function completeMilestone(
        uint agreementId,
        uint milestoneIndex
    )
        external
    {
        Agreement storage agreement = agreements[agreementId];

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
            "Only carrier can complete milestone"
        );

        require(
            milestoneIndex <
                agreementMilestones[agreementId].length,
            "Invalid milestone"
        );

        require(
            milestoneIndex ==
                agreement.currentMilestone,
            "Incorrect milestone order"
        );

        Milestone storage milestone =
            agreementMilestones[
                agreementId
            ][milestoneIndex];

        require(
            !milestone.completed,
            "Milestone already completed"
        );

        require(
            !milestone.paid,
            "Milestone already paid"
        );

        milestone.completed = true;

        emit MilestoneCompleted(
            agreementId,
            milestoneIndex,
            msg.sender
        );
    }


    // =====================================================
    // VERIFY MILESTONE
    //
    // Shipper verifies the completed milestone.
    // Successful verification releases the milestone
    // payment to the Carrier.
    // =====================================================

    function verifyMilestone(
        uint agreementId,
        uint milestoneIndex
    )
        external
    {
        Agreement storage agreement = agreements[agreementId];

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
            "Only shipper can verify milestone"
        );

        require(
            milestoneIndex <
                agreementMilestones[agreementId].length,
            "Invalid milestone"
        );

        require(
            milestoneIndex ==
                agreement.currentMilestone,
            "Incorrect milestone order"
        );

        Milestone storage milestone =
            agreementMilestones[
                agreementId
            ][milestoneIndex];

        require(
            milestone.completed,
            "Milestone not completed"
        );

        require(
            !milestone.verified,
            "Milestone already verified"
        );

        require(
            !milestone.paid,
            "Milestone already paid"
        );

        // Mark verified
        milestone.verified = true;

        // =================================================
        // Calculate payment
        //
        // Last milestone receives all remaining escrow.
        // This prevents rounding issues.
        // =================================================

        uint payment;

        bool isLastMilestone =
            milestoneIndex ==
            agreementMilestones[agreementId].length - 1;

        if (isLastMilestone) {
            payment = agreement.escrowAmount - agreement.escrowReleased;
        }
        else {

            payment =
                (
                    agreement.escrowAmount *
                    milestone.percentage
                ) / 100;
        }

        require(
            payment > 0,
            "No payment available"
        );

        require(
            agreement.escrowReleased + payment
                <= agreement.escrowAmount,
            "Insufficient escrow"
        );

        // =================================================
        // Effects BEFORE transfer
        // =================================================

        milestone.paid = true;
        agreement.escrowReleased += payment;
        agreement.currentMilestone++;


        // =================================================
        // Transfer payment to Carrier
        // =================================================

        (bool success,) =
            agreement.carrier.call{
                value: payment
            }("");

        require(
            success,
            "Milestone payment failed"
        );


        emit MilestoneVerified(
            agreementId,
            milestoneIndex,
            msg.sender
        );

        emit MilestonePaid(
            agreementId,
            milestoneIndex,
            agreement.carrier,
            payment
        );

        // =================================================
        // Complete agreement if all milestones are paid
        // =================================================

        if (
            agreement.currentMilestone ==
            agreementMilestones[agreementId].length
        ) {

            agreement.status =
                AgreementStatus.Completed;

            emit AgreementCompleted(
                agreementId
            );
        }
    }



   // =====================================================
    // CANCEL AGREEMENT
    //
    // Only Shipper can cancel.
    //
    // Cancellation is allowed only before Carrier accepts.
    //
    // Remaining escrow is automatically refunded.
    //
    // Created to Cancelled
    // =====================================================

    function cancelAgreement(
        uint agreementId
    )
        external
    {
        Agreement storage agreement = agreements[agreementId];

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


        // =================================================
        // Calculate remaining escrow
        // =================================================

        uint amount = agreement.escrowAmount - agreement.escrowReleased;


        // =================================================
        // Effects
        // =================================================
        agreement.status = AgreementStatus.Cancelled;


        // =================================================
        // Refund remaining escrow
        // =================================================
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
    // EXPIRE AGREEMENT
    //
    // Anyone can call this after the deadline.
    //
    // Created: Entire escrow refunded.
    //
    // InProgress: Any unpaid escrow refunded.
    //
    // InProgress -> Expired
    // Created -> Expired
    // =====================================================

    function expireAgreement(
        uint agreementId
    )
        external
    {
        Agreement storage agreement = agreements[agreementId];

        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );

        require(
            block.timestamp >
                agreement.deadline,
            "Deadline not passed"
        );

        require(
            agreement.status == AgreementStatus.Created || agreement.status == AgreementStatus.InProgress,
            "Cannot expire"
        );


        // =================================================
        // Calculate remaining escrow
        // =================================================
        uint amount = agreement.escrowAmount - agreement.escrowReleased;


        // =================================================
        // Effects
        // =================================================
        agreement.status = AgreementStatus.Expired;


        // =================================================
        // Refund remaining escrow
        // =================================================
        if(amount > 0){

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


    // =====================================================
    // VIEW MILESTONE
    // =====================================================

    function getMilestone(
        uint agreementId,
        uint milestoneIndex
    )
        external
        view
        returns (
            string memory checkpoint,
            uint percentage,
            bool completed,
            bool verified,
            bool paid
        )
    {
        require(
            milestoneIndex < agreementMilestones[agreementId].length,
            "Invalid milestone"
        );

        Milestone storage milestone = agreementMilestones[agreementId][milestoneIndex];

        return (
            milestone.checkpoint,
            milestone.percentage,
            milestone.completed,
            milestone.verified,
            milestone.paid
        );
    }


    // =====================================================
    // GET MILESTONE COUNT
    // =====================================================
    function getMilestoneCount(
        uint agreementId
    )
        external
        view
        returns(uint)
    {
        return
            agreementMilestones[agreementId].length;
    }


    // =====================================================
    // GET ESCROW REMAINING
    //
    // Calculated instead of stored.
    // =====================================================

    function getEscrowRemaining(
        uint agreementId
    )
        public
        view
        returns(uint)
    {
        Agreement storage agreement = agreements[agreementId];

        if (agreement.escrowReleased >= agreement.escrowAmount) {
            return 0;
        }

        return
            agreement.escrowAmount -
            agreement.escrowReleased;
    }


    // =====================================================
    // GET AGREEMENT COUNT
    // =====================================================

    function getAgreementCount()
        external
        view
        returns(uint)
    {
        return agreementCounter;
    }
}