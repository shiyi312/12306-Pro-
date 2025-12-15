// 12306 下单与排队模块 (Order Logic Module)
// 负责处理从 "点击预订" 到 "最终下单" 的全流程逻辑
// 依赖 NetworkModule 进行请求，依赖 TicketLogicModule 提供车次信息

const OrderLogicModule = (() => {

    // 正则表达式：用于从 HTML 中提取 Token  Key
    const REGEX_TOKEN = /globalRepeatSubmitToken\s*=\s*'(\w+)'/;
    const REGEX_KEY_CHECK = /key_check_isChange\s*=\s*'(\w+)'/;
    const REGEX_KEY_CHECK_FALLBACK = /'key_check_isChange':'(\w+)'/;
    const REGEX_LEFT_TICKET = /'leftTicketStr'\s*:\s*'([^']+)'/;

    // 席别代码映射 (用于 submitOrderRequest 后的后续步骤)
    // 注意：这里的代码 (1, M, O) 与 query 结果中的索引不同，是提交订单时的 seatType 参数
    const SEAT_TYPE_CODE = {
        '商务座': '9',
        '特等座': 'P',
        '一等座': 'M',
        '二等座': 'O',
        '高级软卧': '6',
        '软卧': '4',
        '硬卧': '3',
        '硬座': '1',
        '无座': '1' // 通常无座和硬座代码相同，视具体车次而定
    };

    // 票种代码
    const TICKET_TYPE_CODE = {
        '成人': '1',
        '儿童': '2',
        '学生': '3',
        '残军': '4'
    };

    /**
     * 构造乘客字符串
     * @param {Array<object>} passengers 
     * @param {string} seatCode 
     */
    function buildPassengerStrings(passengers, seatCode) {
        let passengerTicketList = [];
        let oldPassengerList = [];

        passengers.forEach(p => {
            // 票种代码：优先使用 passenger_type (如 "1", "3")，如果没有则尝试从 name 映射，默认 "1" (成人)
            let ticketType = p.passenger_type || TICKET_TYPE_CODE[p.passenger_type_name] || '1';
            
            // 格式: seatType,0,ticketType,name,idType,idNo,mobile,N,allEncStr
            const allEncStr = p.allEncStr || '';
            const pStr = `${seatCode},0,${ticketType},${p.passenger_name},${p.passenger_id_type_code},${p.passenger_id_no},${p.mobile_no || ''},N,${allEncStr}`;
            passengerTicketList.push(pStr);

            const oldStr = `${p.passenger_name},${p.passenger_id_type_code},${p.passenger_id_no},3_`;
            oldPassengerList.push(oldStr);
        });

        return {
            passengerTicketStr: passengerTicketList.join('_'), 
            oldPassengerStr: oldPassengerList.join('') 
        };
    }

    return {
        /**
         * 执行完整的下单流程
         * @param {object} trainInfo - findTargetTrain 返回的车次信息
         * @param {Array<object>} passengers - 乘客列表 [{name: '张三', idType: '1', idNo: '...', type: '成人', mobile: '...'}]
         */
        async executeOrderSequence(trainInfo, passengers) {
            console.log(`[OrderLogic] Starting order sequence for ${trainInfo.trainCode}`);
            
            try {
                // Step 1: 提交预订请求 (submitOrderRequest)
                console.log('[OrderLogic] Step 1: Submitting order request...');
                const submitRes = await NetworkModule.submitOrderRequest(
                    trainInfo.secretStr,
                    trainInfo.trainDate, 
                    trainInfo.trainDate, // 返程日期默认同去程
                    trainInfo.fromStation, 
                    trainInfo.toStation
                );

                if (submitRes.status && !submitRes.status) { // status 为 false 或 messages 有内容
                    throw new Error(`Submit failed: ${submitRes.messages ? submitRes.messages.join(',') : 'Unknown error'}`);
                }
                console.log('[OrderLogic] Step 1 Success');

                // Step 2: 获取 Token (initDc)
                console.log('[OrderLogic] Step 2: Getting token...');
                const htmlContent = await NetworkModule.getInitDcPage();
                
                const tokenMatch = htmlContent.match(REGEX_TOKEN);
                let keyMatch = htmlContent.match(REGEX_KEY_CHECK);
                if (!keyMatch) {
                    keyMatch = htmlContent.match(REGEX_KEY_CHECK_FALLBACK);
                }
                const leftTicketMatch = htmlContent.match(REGEX_LEFT_TICKET);

                if (!tokenMatch || !keyMatch) {
                    throw new Error('Failed to parse Token or KeyCheck from initDc page. (Maybe not logged in?)');
                }

                if (!leftTicketMatch) {
                    throw new Error('Failed to parse leftTicketStr from initDc page.');
                }

                const token = tokenMatch[1];
                const keyCheckIsChange = keyMatch[1];
                const leftTicketStr = leftTicketMatch[1];
                console.log(`[OrderLogic] Token: ${token}, Key: ${keyCheckIsChange}, LeftTicket: ${leftTicketStr}`);

                // Step 3: 构造乘客参数 & 检查订单 (checkOrderInfo)
                const seatCode = SEAT_TYPE_CODE[trainInfo.seatName] || 'O'; // 默认二等座
                const { passengerTicketStr, oldPassengerStr } = buildPassengerStrings(passengers, seatCode);

                console.log('[OrderLogic] Step 3: Checking order info...');
                const checkRes = await NetworkModule.checkOrderInfo(
                    passengerTicketStr,
                    oldPassengerStr,
                    'dc', // 单程
                    token
                );

                if (!checkRes.data || !checkRes.data.submitStatus) {
                     throw new Error(`CheckOrderInfo failed: ${checkRes.data ? checkRes.data.errMsg : 'Unknown'}`);
                }
                console.log('[OrderLogic] Step 3 Success');

                // Step 4: 获取排队人数 (getQueueCount)
                console.log('[OrderLogic] Step 4: Getting queue count...');
                // 需要将 date 格式化为 Fri Dec...
                // 简单处理：new Date(y, m-1, d)
                const dateStr = trainInfo.trainDate; // 20251220 -> 需转换为标准格式
                const y = dateStr.substring(0, 4);
                const m = dateStr.substring(4, 6);
                const d = dateStr.substring(6, 8);
                const dateObj = new Date(`${y}-${m}-${d}`);

                const queueRes = await NetworkModule.getQueueCount(
                    dateObj,
                    trainInfo.trainNo,
                    trainInfo.trainCode,
                    seatCode,
                    trainInfo.fromStation, 
                    trainInfo.toStation,
                    token
                );
                
                // 检查是否有余票
                // queueRes.data.countT (排队人数)
                // queueRes.data.ticket (余票数)
                console.log(`[OrderLogic] Queue info: count=${queueRes.data.countT}, ticket=${queueRes.data.ticket}`);
                
                // Step 5: 最终提交 (confirmSingleForQueue)
                console.log('[OrderLogic] Step 5: Confirming order...');
                const confirmRes = await NetworkModule.confirmSingleForQueue(
                    passengerTicketStr,
                    oldPassengerStr,
                    keyCheckIsChange,
                    token,
                    leftTicketStr, // 使用 initDc 页面提取的 leftTicketStr
                    trainInfo.trainLocation // 需要 TicketLogicModule 提供
                );

                if (confirmRes.data && confirmRes.data.submitStatus) {
                    console.log('🎉 [OrderLogic] ORDER SUBMITTED SUCCESSFULLY!');
                    return { success: true, orderId: null }; // 此时可能还没有 orderId，需要进一步 queryOrderWaitTime
                } else {
                    throw new Error(`Confirm failed: ${confirmRes.data ? confirmRes.data.errMsg : 'Unknown'}`);
                }

            } catch (error) {
                console.error('[OrderLogic] Order Sequence Failed:', error);
                return { success: false, error: error.message };
            }
        },
        
        // 暴露 helper 用于测试
        _buildPassengerStrings: buildPassengerStrings
    };
})();


// === 测试代码 ===
async function runOrderTests() {
    console.log('>>> 开始 OrderLogic 模块测试 <<<');

    // 1. 测试乘客字符串构造
    console.log('Testing string builder...');
    const mockPassengers = [
        {
            "passenger_name": "缪志远",
            "sex_code": "M",
            "sex_name": "男",
            "born_date": "2000-11-08 00:00:00",
            "country_code": "CHN",
            "passenger_id_type_code": "1",
            "passenger_id_type_name": "居民身份证",
            "passenger_id_no": "3310***********011",
            "passenger_type": "3",
            "passenger_type_name": "学生",
            "mobile_no": "159****6398",
            "phone_no": "",
            "email": "75*****48@qq.com",
            "address": "",
            "postalcode": "",
            "first_letter": "MZY",
            "recordCount": "6",
            "isUserSelf": "Y",
            "total_times": "99",
            "index_id": "0",
            "allEncStr": "f6ae2a78a41a5e9356a956c4fd2c6ba6a476edcb40a2f24f2671f3b05b16611d80f7ad1475440c21db4e6727e28a0ce161c43b652917c000a3a7d5bca57ee1e1afeb7e6b2b6e55dee335798194bbfde7dee4af3f0947645264e03dea190d5e32",
            "isAdult": "Y",
            "isYongThan10": "N",
            "isYongThan14": "N",
            "isOldThan60": "N",
            "if_receive": "Y",
            "is_active": "Y",
            "is_buy_ticket": "N",
            "last_time": "20190721203041",
            "passenger_uuid": "7728c42faf4f0271e1757e8daecbe31a2e6d00dc6bb3003c48d9ce25c714d934",
            "if_preferential": "",
            "mobile_code": "86",
            "temporay_age60": "N",
            "gat_born_date": "20001108",
            "gat_valid_date_start": "",
            "gat_valid_date_end": "",
            "gat_version": ""
            },
            {
            "passenger_name": "缪志远",
            "sex_code": "M",
            "sex_name": "男",
            "born_date": "2000-11-08 00:00:00",
            "country_code": "CHN",
            "passenger_id_type_code": "1",
            "passenger_id_type_name": "居民身份证",
            "passenger_id_no": "3310***********011",
            "passenger_type": "3",
            "passenger_type_name": "学生",
            "mobile_no": "159****6398",
            "phone_no": "",
            "email": "75*****48@qq.com",
            "address": "",
            "postalcode": "",
            "first_letter": "MZY",
            "recordCount": "6",
            "isUserSelf": "Y",
            "total_times": "99",
            "index_id": "0",
            "allEncStr": "f6ae2a78a41a5e9356a956c4fd2c6ba6a476edcb40a2f24f2671f3b05b16611d80f7ad1475440c21db4e6727e28a0ce161c43b652917c000a3a7d5bca57ee1e1afeb7e6b2b6e55dee335798194bbfde7dee4af3f0947645264e03dea190d5e32",
            "isAdult": "Y",
            "isYongThan10": "N",
            "isYongThan14": "N",
            "isOldThan60": "N",
            "if_receive": "Y",
            "is_active": "Y",
            "is_buy_ticket": "N",
            "last_time": "20190721203041",
            "passenger_uuid": "7728c42faf4f0271e1757e8daecbe31a2e6d00dc6bb3003c48d9ce25c714d934",
            "if_preferential": "",
            "mobile_code": "86",
            "temporay_age60": "N",
            "gat_born_date": "20001108",
            "gat_valid_date_start": "",
            "gat_valid_date_end": "",
            "gat_version": ""
            }
    ];
    const { passengerTicketStr, oldPassengerStr } = OrderLogicModule._buildPassengerStrings(mockPassengers, 'O');
    
    console.log('passengerTicketStr:', passengerTicketStr);
    // console.log('Expected (approx): O,0,1,王小明,1,110101199001011234,13900000000,N');
    
    console.log('oldPassengerStr:', oldPassengerStr);
    // console.log('Expected (approx): 王小明,1,110101199001011234,1_');

    // if (passengerTicketStr.includes('王小明') && oldPassengerStr.includes('1_')) {
    //     console.log('✅ String Builder Test Passed');
    // } else {
    //     console.error('❌ String Builder Test Failed');
    // }

    console.log('NOTE: 真实下单测试需要登录且有真实 secretStr，请在完整流程中测试。');
    console.log('>>> 测试结束 <<<');
}

window.OrderLogicModule = OrderLogicModule;
window.runOrderTests = runOrderTests;
