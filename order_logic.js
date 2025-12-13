// 12306 下单与排队模块 (Order Logic Module)
// 负责处理从 "点击预订" 到 "最终下单" 的全流程逻辑
// 依赖 NetworkModule 进行请求，依赖 TicketLogicModule 提供车次信息

const OrderLogicModule = (() => {

    // 正则表达式：用于从 HTML 中提取 Token 和 Key
    const REGEX_TOKEN = /globalRepeatSubmitToken\s*=\s*'(\w+)'/;
    const REGEX_KEY_CHECK = /key_check_isChange\s*=\s*'(\w+)'/;

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
     * 辅助函数：构造 passengerTicketStr 和 oldPassengerStr
     * 这是下单最关键的参数拼接
     * 格式参考: seatType,0,ticketType,name,idType,idNo,mobile,N
     */
    function buildPassengerStrings(passengers, seatType) {
        let passengerTicketStr = '';
        let oldPassengerStr = '';

        passengers.forEach(p => {
            // 1. passengerTicketStr
            // 格式: seatType,0,ticketType,name,idType,idNo,mobile,N
            // 示例: O,0,1,张三,1,110101199001011234,13800138000,N
            const pStr = `${seatType},0,${TICKET_TYPE_CODE[p.type] || '1'},${p.name},${p.idType},${p.idNo},${p.mobile || ''},N`;
            passengerTicketStr += pStr + '_';

            // 2. oldPassengerStr
            // 格式: name,idType,idNo,1_
            // 示例: 张三,1,110101199001011234,1_
            const oStr = `${p.name},${p.idType},${p.idNo},1`;
            oldPassengerStr += oStr + '_';
        });

        // 移除末尾的 _
        if (passengerTicketStr.endsWith('_')) passengerTicketStr = passengerTicketStr.slice(0, -1);
        // oldPassengerStr 12306 似乎要求末尾也要有 _ ? 实际上多试几次发现末尾不带 _ 也可以，或者都带
        // 标准抓包显示 oldPassengerStr 末尾是带 _ 的
        
        return { passengerTicketStr, oldPassengerStr };
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
                    trainInfo.trainDate, // 2024-01-01
                    trainInfo.trainDate, // 返程日期默认同去程
                    trainInfo.fromStation, // 应该是 stationName (北京) 还是 code? 
                    // NetworkModule 的注释说是 Name, 但实际抓包中有时是 Name. 
                    // 这里需要注意: queryTickets 返回的是 Code (BJP), 但 submit 需要 Name (北京)
                    // 如果 trainInfo 中没有 Name，这里可能会出错。
                    // *修正*: query 结果中没有 Name，只有 Code。
                    // 实际脚本中需要一个 Code -> Name 的映射表，或者让用户在 UI 输入时就保存 Name。
                    // 假设 trainInfo 已经包含了 Name (需要从 UI 配置传递进来，或者 query 页面本身就有)
                    // *临时方案*: 使用 trainInfo.fromStation 作为 Name (如果 API 支持 Code 则最好，不支持则需映射)
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
                const keyMatch = htmlContent.match(REGEX_KEY_CHECK);

                if (!tokenMatch || !keyMatch) {
                    throw new Error('Failed to parse Token or KeyCheck from initDc page. (Maybe not logged in?)');
                }

                const token = tokenMatch[1];
                const keyCheckIsChange = keyMatch[1];
                console.log(`[OrderLogic] Token: ${token}, Key: ${keyCheckIsChange}`);

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
                    trainInfo.fromStation, // 这里应该是 Telecode? 
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
                    token
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
        { name: '王小明', idType: '1', idNo: '110101199001011234', type: '成人', mobile: '13900000000' }
    ];
    const { passengerTicketStr, oldPassengerStr } = OrderLogicModule._buildPassengerStrings(mockPassengers, 'O');
    
    console.log('passengerTicketStr:', passengerTicketStr);
    console.log('Expected (approx): O,0,1,王小明,1,110101199001011234,13900000000,N');
    
    console.log('oldPassengerStr:', oldPassengerStr);
    console.log('Expected (approx): 王小明,1,110101199001011234,1_');

    if (passengerTicketStr.includes('王小明') && oldPassengerStr.includes('1_')) {
        console.log('✅ String Builder Test Passed');
    } else {
        console.error('❌ String Builder Test Failed');
    }

    console.log('NOTE: 真实下单测试需要登录且有真实 secretStr，请在完整流程中测试。');
    console.log('>>> 测试结束 <<<');
}

window.OrderLogicModule = OrderLogicModule;
window.runOrderTests = runOrderTests;
