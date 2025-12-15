// 12306 网络请求模块 (Network Module)
// 该模块封装了核心的 HTTP 请求，模拟 12306 的关键接口调用。
// 为了便于在浏览器控制台直接测试，这里使用了标准 fetch API (油猴脚本中可替换为 GM_xmlhttpRequest 以跨域，但在 12306 域名下 fetch 足够)

const NetworkModule = (() => {
    // 基础配置
    const BASE_URL = 'https://kyfw.12306.cn';
    
    // 动态获取查询接口 URL（12306 的查询接口经常变动，如 /otn/leftTicket/queryA, queryZ 等）
    // 这里预留一个动态获取的机制，目前默认指向一个常见地址
    let QUERY_URL = '/otn/leftTicket/query'; 

    /**
     * 通用请求封装
     * @param {string} url - 请求路径
     * @param {object} options - fetch 选项
     * @returns {Promise<any>} - 解析后的 JSON 数据
     */
    async function request(url, options = {}) {
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest', // 模拟 AJAX
                'Referer': 'https://kyfw.12306.cn/otn/leftTicket/init', // 强行指定 Referer
                'Host': 'kyfw.12306.cn',
                'Origin': 'https://kyfw.12306.cn'
            },
        };

        const finalOptions = { ...defaultOptions, ...options };
        // 合并 headers
        if (options.headers) {
            finalOptions.headers = { ...defaultOptions.headers, ...options.headers };
        }

        // 拼接完整 URL (如果是相对路径)
        const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

        try {
            console.log(`[Network] Sending request to: ${fullUrl}`);
            const response = await fetch(fullUrl, finalOptions);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 12306 大部分接口返回 JSON，但出错或特定接口可能返回 HTML
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                return data;
            } else {
                // 如果不是 JSON，尝试读取文本并根据情况处理
                const text = await response.text();
                // 尝试手动解析 JSON (有些接口 content-type 不规范)
                try {
                    return JSON.parse(text);
                } catch (e) {
                    // 确实不是 JSON，返回文本或根据内容判断错误
                    console.warn('[Network] Response is not JSON:', text.substring(0, 100) + '...');
                    return { status: false, messages: ['Response is not JSON', text.substring(0, 200)] };
                }
            }
        } catch (error) {
            console.error('[Network] Request failed:', error);
            throw error;
        }
    }

    return {
        /**
         * 1. 检查用户登录状态
         * URL: https://kyfw.12306.cn/otn/login/checkUser
         * @returns {Promise<boolean>} true 已登录, false 未登录
         */
        async checkLoginStatus() {
            try {
                // 这是一个常用的检查登录状态接口
                const data = await request('/otn/login/checkUser', {
                    method: 'POST',
                    body: '_json_att=', // 这是一个常见的空参数
                });
                // data.data.flag 为 true 表示已登录
                return data && data.data && data.data.flag === true;
            } catch (e) {
                console.warn('[Network] Check login failed, assuming not logged in.', e);
                return false;
            }
        },

        /**
         * 2. 查询车票
         * URL: https://kyfw.12306.cn/otn/leftTicket/query?leftTicketDTO.train_date=2025-12-20&leftTicketDTO.from_station=BJP&leftTicketDTO.to_station=SHH&purpose_codes=ADULT
         * @param {string} trainDate - 发车日期 (格式: 2024-01-01)
         * @param {string} fromStation - 出发站代码 (如: BJP)
         * @param {string} toStation - 到达站代码 (如: SHH)
         * @param {string} purposeCodes - 乘客类型 (ADULT: 成人, 0X00: 学生) 默认 ADULT
         */
        async queryTickets(trainDate, fromStation, toStation, purposeCodes = 'ADULT') {
            // 注意：实际 URL 可能会变，这里使用变量 QUERY_URL
            // 构造查询参数
            const params = new URLSearchParams({
                'leftTicketDTO.train_date': trainDate,
                'leftTicketDTO.from_station': fromStation,
                'leftTicketDTO.to_station': toStation,
                'purpose_codes': purposeCodes
            });

            // 尝试探测正确的查询接口 (简单模拟)
            // 实际场景中可能需要先请求 init 页面解析出 CLeftTicketUrl
            
            const url = `${QUERY_URL}?${params.toString()}`;
            
            try {
                const data = await request(url);
                return data;
            } catch (e) {
                console.error('[Network] Query tickets failed:', e);
                throw e;
            }
        },

        /**
         * 3. 提交订单请求 (Step 1: 点击预订按钮)
         * URL: https://kyfw.12306.cn/otn/leftTicket/submitOrderRequest
         * @param {string} secretStr - 车次加密字符串 (从查询结果中获取)
         * @param {string} trainDate - 发车日期 (2024-01-01)
         * @param {string} backTrainDate - 返程日期 (通常同发车日期)
         * @param {string} fromStationName - 出发站名称 (北京)
         * @param {string} toStationName - 到达站名称 (上海)
         */
        async submitOrderRequest(secretStr, trainDate, backTrainDate, fromStationName, toStationName) {
            const body = new URLSearchParams({
                'secretStr': decodeURIComponent(secretStr), // 必须解码
                'train_date': trainDate,
                'back_train_date': backTrainDate,
                'tour_flag': 'dc', // 单程
                'purpose_codes': 'ADULT',
                'query_from_station_name': fromStationName,
                'query_to_station_name': toStationName,
                'undefined': '' 
            });

            return request('/otn/leftTicket/submitOrderRequest', {
                method: 'POST',
                body: body
            });
        },

        /**
         * 4. 获取订单 Token (Step 2: 进入订单确认页面的初始化)
         * URL: https://kyfw.12306.cn/otn/confirmPassenger/initDc
         * 这一步通常返回 HTML，包含 globalRepeatSubmitToken
         * @returns {Promise<string>} HTML 文本，需要自行正则提取 Token
         */
        async getInitDcPage() {
            // 这个请求返回的是 HTML 页面
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: '_json_att='
            };
            
            // 特殊处理：fetch 返回 text 而不是 json
            try {
                const response = await fetch(`${BASE_URL}/otn/confirmPassenger/initDc`, options);
                return await response.text();
            } catch (e) {
                console.error('[Network] Get initDc page failed:', e);
                throw e;
            }
        },
        
        /**
         * 5. 获取乘客列表
         * URL: https://kyfw.12306.cn/otn/confirmPassenger/getPassengerDTOs
         * @returns {Promise<object>} 乘客列表数据
         */
        async getPassengerDTOs() {
             const body = new URLSearchParams({
                '_json_att': ''
            });
            return request('/otn/confirmPassenger/getPassengerDTOs', {
                method: 'POST',
                body: body
            });
        },

        /**
         * 6. 检查订单信息 (Step 3: 验证选座和乘客)
         * URL: https://kyfw.12306.cn/otn/confirmPassenger/checkOrderInfo
         * @param {string} passengerTicketStr - 乘客车票信息串
         * @param {string} oldPassengerStr - 旧乘客信息串
         * @param {string} tourFlag - 类型 (dc: 单程)
         * @param {string} token - globalRepeatSubmitToken
         */
        async checkOrderInfo(passengerTicketStr, oldPassengerStr, tourFlag = 'dc', token) {
             const body = new URLSearchParams({
                'cancel_flag': '2',
                'bed_level_order_num': '000000000000000000000000000000',
                'passengerTicketStr': passengerTicketStr,
                'oldPassengerStr': oldPassengerStr,
                'tour_flag': tourFlag,
                'randCode': '',
                'whatsSelect': '1',
                'sessionId': '',
                'sig': '',
                'scene': 'nc_login', // 可能涉及到滑动验证的场景参数
                '_json_att': '',
                'REPEAT_SUBMIT_TOKEN': token
            });

            return request('/otn/confirmPassenger/checkOrderInfo', {
                method: 'POST',
                body: body
            });
        },
        
        /**
         * 7. 获取排队人数 (Step 4: 检查是否有余票和排队)
         * URL: https://kyfw.12306.cn/otn/confirmPassenger/getQueueCount
         * @param {string} trainDate - 日期
         * @param {string} trainNo - 列车编号
         * @param {string} stationTrainCode - 车次代码 (G101)
         * @param {string} seatType - 席别代码
         * @param {string} fromStationTelecode - 出发站电报码
         * @param {string} toStationTelecode - 到达站电报码
         * @param {string} token - token
         */
        async getQueueCount(trainDate, trainNo, stationTrainCode, seatType, fromStationTelecode, toStationTelecode, token) {
             const body = new URLSearchParams({
                'train_date': new Date(trainDate).toString(), // 格式需注意，通常是标准时间字符串
                'train_no': trainNo,
                'stationTrainCode': stationTrainCode,
                'seatType': seatType,
                'fromStationTelecode': fromStationTelecode,
                'toStationTelecode': toStationTelecode,
                'leftTicket': '', // 有时候需要从 checkOrderInfo 返回中获取
                'purpose_codes': '00',
                'train_location': '', // 需从 query 结果获取
                '_json_att': '',
                'REPEAT_SUBMIT_TOKEN': token
            });

            return request('/otn/confirmPassenger/getQueueCount', {
                method: 'POST',
                body: body
            });
        },

        /**
         * 8. 确认提交队列 (Step 5: 最终下单)
         * URL: https://kyfw.12306.cn/otn/confirmPassenger/confirmSingleForQueue
         * @param {string} passengerTicketStr
         * @param {string} oldPassengerStr
         * @param {string} keyCheckIsChange - 从 initDc 页面提取
         * @param {string} token
         * @param {string} leftTicketStr - 从 getQueueCount 返回的 ticket 字段获取
         * @param {string} trainLocation - 从 queryTickets 结果的第 16 位 (index 15) 获取
         */
        async confirmSingleForQueue(passengerTicketStr, oldPassengerStr, keyCheckIsChange, token, leftTicketStr, trainLocation) {
             const body = new URLSearchParams({
                'passengerTicketStr': passengerTicketStr,
                'oldPassengerStr': oldPassengerStr,
                'purpose_codes': '00',
                'key_check_isChange': keyCheckIsChange,
                'leftTicketStr': leftTicketStr, // 还原：直接传递，让 URLSearchParams 自动进行必要的二次编码
                'train_location': trainLocation, 
                'choose_seats': '',
                'seatDetailType': '000', // 默认 000
                'is_jy': 'N', // 新增参数
                'is_cj': 'Y', // 改回 Y (匹配用户成功抓包)
                'encryptedData': '', // 新增参数
                'whatsSelect': '1',
                'roomType': '00',
                'dwAll': 'N',
                '_json_att': '',
                'REPEAT_SUBMIT_TOKEN': token
            });

            // console.log('confirmSingleForQueue request body:', body.toString());

            return request('/otn/confirmPassenger/confirmSingleForQueue', {
                method: 'POST',
                body: body
            });
        },

        // 设置查询接口地址（用于外部动态更新）
        setQueryUrl(url) {
            QUERY_URL = url;
            console.log(`[Network] Query URL updated to: ${QUERY_URL}`);
        }
    };
})();

// === 测试代码 (Test Suite) ===
// 复制以下代码到 12306 官网控制台运行

async function runNetworkTests() {
    console.log('>>> 开始网络模块测试 <<<');
    
    // 1. 测试登录状态
    console.log('Testing checkLoginStatus...');
    const isLogged = await NetworkModule.checkLoginStatus();
    console.log(`Login Status: ${isLogged ? 'LOGGED IN' : 'NOT LOGGED IN'}`);
    
    if (!isLogged) {
        console.warn('⚠️ 警告：未登录状态下后续测试可能会失败！请先在网页上登录 12306。');
    }

    // 2. 测试查票 (真实获取 secretStr)
    const today = new Date();
    today.setDate(today.getDate() + 13); // 查明天的票
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // 假设查询 北京 -> 上海 (BJP -> SHH)
    // 请根据实际有票的线路调整这里，否则后续步骤无法进行
    const testFromStationCode = 'SHH'; 
    const testToStationCode = 'TEU';
    const testFromStationName = '上海'; // 必须与 Code 对应
    const testToStationName = '台州';

    console.log(`Testing queryTickets (Date: ${dateStr}, ${testFromStationName} -> ${testToStationName})...`);
    
    let realSecretStr = '';
    let realTrainInfo = null;

    try {
        const tickets = await NetworkModule.queryTickets(dateStr, testFromStationCode, testToStationCode);
        console.log('Query Result:', tickets);
        
        if (tickets.data && tickets.data.result && tickets.data.result.length > 0) {
            console.log('✅ 查票成功，获取到', tickets.data.result.length, '个车次');
            
            // 尝试找到一个有票的车次 (secretStr 不为空，且有票)
            // 简单的解析逻辑：result 是字符串数组，secretStr 是第一部分
            for (let i = 0; i < tickets.data.result.length; i++) {
                const raw = tickets.data.result[i];
                const parts = raw.split('|');
                const secret = parts[0];
                const canBuy = parts[11]; // Y 代表可买
                const trainCode = parts[3];

                if (secret && canBuy === 'Y') {
                    console.log(`✅ Found available train: ${trainCode}`);
                    realSecretStr = secret;
                    realTrainInfo = {
                        trainDate: dateStr, 
                        trainCode: trainCode,
                        trainNo: parts[2], // 240000G11526
                        fromStationTelecode: parts[6], // VNP
                        toStationTelecode: parts[7],   // HGH
                        trainLocation: parts[15]       // train_location (index 15)
                    };
                    break; 
                }
            }

            if (!realSecretStr) {
                console.warn('⚠️ 查票成功但没有找到可预订的车次 (所有车次 secretStr 为空或不可买)');
            }

        } else {
            console.warn('⚠️ 查票成功但无数据，或接口被风控');
        }
    } catch (e) {
        console.error('❌ 查票请求失败', e);
    }

    // 3. 测试提交订单请求 (Step 1: 点击预订按钮)
    // 使用上一步获取的真实 secretStr
    if (realSecretStr) {
        console.log(`Testing submitOrderRequest (Real Data: ${realTrainInfo.trainCode})...`);
        try {
            const submitRes = await NetworkModule.submitOrderRequest(
                realSecretStr,
                dateStr, // train_date
                dateStr, // back_train_date
                testFromStationName,
                testToStationName
            );
            console.log('Submit Result:', submitRes);
            
            if (submitRes.status) {
                console.log('✅ 提交预订请求成功 (Status: true)');
            } else {
                console.warn('⚠️ 提交预订请求返回 false');
                if (submitRes.messages) console.warn('Messages:', submitRes.messages);
                // 如果这里失败，后续步骤通常也会因为没有建立起订单上下文而失败
            }
        } catch (e) {
            console.error('❌ 提交预订请求失败', e);
        }
    } else {
        console.warn('⚠️ Skipping submitOrderRequest (No valid secretStr found).');
    }

    // 4. 测试获取 initDc 页面 (获取 Token)
    console.log('Testing getInitDcPage...');
    let token = '';
    let keyCheckIsChange = '';
    let leftTicketStr = '';
    try {
        const html = await NetworkModule.getInitDcPage();
        console.log('InitDc Page Length:', html.length);
        
        // 尝试提取 Token
        // 格式可能是 var globalRepeatSubmitToken = '...' 或 'globalRepeatSubmitToken':'...'
        // 为了更稳健，我们使用两个正则尝试匹配
        let tokenMatch = html.match(/globalRepeatSubmitToken\s*=\s*'(\w+)'/);
        if (!tokenMatch) tokenMatch = html.match(/'?globalRepeatSubmitToken'?\s*[:=]\s*'(\w+)'/);

        let keyMatch = html.match(/key_check_isChange\s*=\s*'(\w+)'/);
        if (!keyMatch) keyMatch = html.match(/'?key_check_isChange'?\s*[:=]\s*'(\w+)'/);

        let leftTicketMatch = html.match(/'leftTicketStr'\s*:\s*'([^']+)'/); // 尝试匹配 initDc 中的 leftTicketStr
        
        if (tokenMatch && keyMatch) {
            token = tokenMatch[1];
            keyCheckIsChange = keyMatch[1];
            console.log(`✅ Token extracted: ${token}`);
            console.log(`✅ Key extracted: ${keyCheckIsChange}`);
        } else {
            console.warn('⚠️ Token extraction failed. (Possibly not logged in)');
            console.warn('HTML :', html);
        }

        if (leftTicketMatch && leftTicketMatch[1]) {
            leftTicketStr = leftTicketMatch[1];
            console.log(`✅ LeftTicketStr extracted: ${leftTicketStr}`);
        } else {
            console.log('ℹ️ LeftTicketStr not found in initDc');
        }
    } catch (e) {
        console.error('❌ getInitDcPage failed', e);
    }

    // 5. 测试获取乘客列表
    console.log('Testing getPassengerDTOs...');
    let passenger = null;
    try {
        const passengers = await NetworkModule.getPassengerDTOs();
        console.log('Passenger Data:', passengers);
        if (passengers.data && passengers.data.normal_passengers && passengers.data.normal_passengers.length > 0) {
            console.log(`✅ Retrieved ${passengers.data.normal_passengers.length} passengers.`);
            passenger = passengers.data.normal_passengers[0]; // 取第一个乘客用于后续测试
            console.log('Using passenger:', passenger.passenger_name);
            console.log('Passenger allEncStr:', passenger.allEncStr); // 打印加密串
        } else {
            console.warn('⚠️ No passengers found or not logged in.');
        }
    } catch (e) {
        console.error('❌ getPassengerDTOs failed', e);
    }

    // 如果有 Token 和乘客信息，继续测试后续流程
    if (token && passenger) {
        
        // 构造测试用的乘客字符串
        // 假设抢二等座 (O)
        // 格式更新：seatType,0,ticketType,name,idType,idNo,mobile,N,allEncStr
        const seatType = 'O';
        const ticketType = '1'; // 成人
        const allEncStr = passenger.allEncStr || ''; // 获取加密串
        
        const passengerTicketStr = `${seatType},0,${ticketType},${passenger.passenger_name},${passenger.passenger_id_type_code},${passenger.passenger_id_no},${passenger.mobile_no || ''},N,${allEncStr}`;
        const oldPassengerStr = `${passenger.passenger_name},${passenger.passenger_id_type_code},${passenger.passenger_id_no},3_`;

        console.log('Constructed passengerTicketStr:', passengerTicketStr);

        // 6. 测试 checkOrderInfo
        console.log('Testing checkOrderInfo...');
        try {
            const checkRes = await NetworkModule.checkOrderInfo(passengerTicketStr, oldPassengerStr, 'dc', token);
            console.log('CheckOrderInfo Result:', checkRes);
            if (checkRes.data && checkRes.data.submitStatus) {
                console.log('✅ checkOrderInfo Passed');
            } else {
                console.warn('⚠️ checkOrderInfo Failed:', checkRes.data ? checkRes.data.errMsg : 'Unknown');
            }
        } catch (e) {
            console.error('❌ checkOrderInfo failed', e);
        }

        // 7. 测试 getQueueCount (获取排队)
        console.log('Testing getQueueCount...');
        if (realTrainInfo) {
            try {
                 const queueRes = await NetworkModule.getQueueCount(
                    new Date(realTrainInfo.trainDate), // 2025-12-13
                    realTrainInfo.trainNo, // trainNo (需要解析)
                    realTrainInfo.trainCode, // G115
                    seatType,       // seatType (二等座)
                    realTrainInfo.fromStationTelecode, // VNP
                    realTrainInfo.toStationTelecode,   // HGH
                    token
                );
                console.log('Queue Result:', queueRes);
                if (queueRes.data) {
                    console.log(`✅ Queue Info: Count=${queueRes.data.countT}, Ticket=${queueRes.data.ticket}, Op=${queueRes.data.op_2}`);
                }
            } catch (e) {
                console.error('❌ getQueueCount failed', e);
            }
        } else {
             console.warn('⚠️ Skipping getQueueCount (No real train info).');
        }

        // 8. 测试 confirmSingleForQueue (最终下单 - 慎用！)
        console.log('Testing confirmSingleForQueue...');

        if (realTrainInfo && leftTicketStr) {
             try {
                // 注意：这里仍然有风险，如果你不想真的下单，请不要解开下面的注释，或者确保账号里没有钱

                // const confirmRes = await NetworkModule.confirmSingleForQueue(
                //     passengerTicketStr, 
                //     oldPassengerStr, 
                //     keyCheckIsChange, 
                //     token, 
                //     leftTicketStr, 
                //     realTrainInfo.trainLocation
                // );
                // console.log('Confirm Result:', confirmRes);

                console.log('⚠️ confirmSingleForQueue call is ready but commented out. Params check:');
                console.log('   leftTicketStr (Used):', leftTicketStr);
                console.log('   trainLocation:', realTrainInfo.trainLocation);
                console.log('   keyCheckIsChange:', keyCheckIsChange);
            } catch (e) {
                console.error('❌ confirmSingleForQueue failed', e);
            }
        } else {
            console.warn('⚠️ Skipping confirmSingleForQueue: Missing leftTicketStr or trainLocation');
        }
    } else {
        console.warn('⚠️ Skipping Steps 6-8 due to missing Token or Passenger info.');
    }
    
    console.log('>>> 测试结束 <<<');
}

// 暴露给全局以便调用
window.NetworkModule = NetworkModule;
window.runNetworkTests = runNetworkTests;

console.log('NetworkModule loaded. Run `runNetworkTests()` to test.');
