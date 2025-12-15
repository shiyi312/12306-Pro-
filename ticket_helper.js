// ==UserS,ript==
// @name         12306 抢票助手 Pro
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  自动查票、下单 (集成 Network, Ticket, Order, UI 模块)
// @author       kl2
// @match        https://kyfw.12306.cn/otn/*
// @match        https://www.12306.cn/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log('>>> 12306 抢票助手 Pro 已加载 <<<');

    // ==========================================
    // 0. Configuration (配置)
    // ==========================================
    // 站点简码映射表 (Name -> Code)
    // 请在此处补充完整的站点映射，例如: { '北京': 'BJP', '上海': 'SHH', ... }
    // 可以从 https://kyfw.12306.cn/otn/resources/js/framework/station_name.js 获取
    let stationMap = {};

    async function fetchStationMap() {
        try {
            console.log('正在获取站点简码表...');
            const response = await fetch('https://kyfw.12306.cn/otn/resources/js/framework/station_name.js');
            const text = await response.text();
            // 格式: var station_names ='@bjb|北京北|VAP|beijingbei|bjb|0@bjd|北京东|BOP|beijingdong|bjd|1...'
            const start = text.indexOf("'");
            const end = text.lastIndexOf("'");
            if (start > -1 && end > -1) {
                const data = text.substring(start + 1, end);
                const parts = data.split('@');
                parts.forEach(part => {
                    if (!part) return;
                    const fields = part.split('|');
                    if (fields.length >= 3) {
                        stationMap[fields[1]] = fields[2];
                    }
                });
                const count = Object.keys(stationMap).length;
                console.log(`站点简码表加载完成，共 ${count} 个站点`);
                if (typeof UIModule !== 'undefined' && UIModule.log) {
                    UIModule.log(`站点简码表加载完成，共 ${count} 个站点`, 'success');
                }
            }
        } catch (e) {
            console.error('获取站点简码表失败:', e);
            if (typeof UIModule !== 'undefined' && UIModule.log) {
                UIModule.log('获取站点简码表失败，请检查网络', 'error');
            }
        }
    }

    // ==========================================
    // 1. NetworkModule (网络请求)
    // ==========================================
    const NetworkModule = (() => {
        const BASE_URL = 'https://kyfw.12306.cn';
        let QUERY_URL = '/otn/leftTicket/query'; 

        async function request(url, options = {}) {
            const defaultOptions = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://kyfw.12306.cn/otn/leftTicket/init',
                    'Host': 'kyfw.12306.cn',
                    'Origin': 'https://kyfw.12306.cn'
                },
            };
            const finalOptions = { ...defaultOptions, ...options };
            if (options.headers) {
                finalOptions.headers = { ...defaultOptions.headers, ...options.headers };
            }
            const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
            try {
                // console.log(`[Network] Sending request to: ${fullUrl}`);
                const response = await fetch(fullUrl, finalOptions);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    return await response.json();
                } else {
                    const text = await response.text();
                    try { return JSON.parse(text); } 
                    catch (e) { return { status: false, messages: ['Response is not JSON', text.substring(0, 200)] }; }
                }
            } catch (error) {
                console.error('[Network] Request failed:', error);
                throw error;
            }
        }

        return {
            async checkLoginStatus() {
                try {
                    const data = await request('/otn/login/checkUser', { method: 'POST', body: '_json_att=' });
                    return data && data.data && data.data.flag === true;
                } catch (e) { return false; }
            },
            async queryTickets(trainDate, fromStation, toStation, purposeCodes = 'ADULT') {
                const params = new URLSearchParams({
                    'leftTicketDTO.train_date': trainDate,
                    'leftTicketDTO.from_station': fromStation,
                    'leftTicketDTO.to_station': toStation,
                    'purpose_codes': purposeCodes
                });
                return request(`${QUERY_URL}?${params.toString()}`);
            },
            async submitOrderRequest(secretStr, trainDate, backTrainDate, fromStationName, toStationName) {
                const body = new URLSearchParams({
                    'secretStr': decodeURIComponent(secretStr),
                    'train_date': trainDate,
                    'back_train_date': backTrainDate,
                    'tour_flag': 'dc',
                    'purpose_codes': 'ADULT',
                    'query_from_station_name': fromStationName,
                    'query_to_station_name': toStationName,
                    'undefined': '' 
                });
                return request('/otn/leftTicket/submitOrderRequest', { method: 'POST', body: body });
            },
            async getInitDcPage() {
                try {
                    const response = await fetch(`${BASE_URL}/otn/confirmPassenger/initDc`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: '_json_att='
                    });
                    return await response.text();
                } catch (e) { throw e; }
            },
            async getPassengerDTOs() {
                return request('/otn/confirmPassenger/getPassengerDTOs', { method: 'POST', body: '_json_att=' });
            },
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
                    'scene': 'nc_login',
                    '_json_att': '',
                    'REPEAT_SUBMIT_TOKEN': token
                });
                return request('/otn/confirmPassenger/checkOrderInfo', { method: 'POST', body: body });
            },
            async getQueueCount(trainDate, trainNo, stationTrainCode, seatType, fromStationTelecode, toStationTelecode, token) {
                 const body = new URLSearchParams({
                    'train_date': new Date(trainDate).toString(),
                    'train_no': trainNo,
                    'stationTrainCode': stationTrainCode,
                    'seatType': seatType,
                    'fromStationTelecode': fromStationTelecode,
                    'toStationTelecode': toStationTelecode,
                    'leftTicket': '', 
                    'purpose_codes': '00',
                    'train_location': '',
                    '_json_att': '',
                    'REPEAT_SUBMIT_TOKEN': token
                });
                return request('/otn/confirmPassenger/getQueueCount', { method: 'POST', body: body });
            },
            async confirmSingleForQueue(passengerTicketStr, oldPassengerStr, keyCheckIsChange, token, leftTicketStr, trainLocation) {
                 const body = new URLSearchParams({
                    'passengerTicketStr': passengerTicketStr,
                    'oldPassengerStr': oldPassengerStr,
                    'purpose_codes': '00',
                    'key_check_isChange': keyCheckIsChange,
                    'leftTicketStr': leftTicketStr, // 直接传递
                    'train_location': trainLocation, 
                    'choose_seats': '',
                    'seatDetailType': '000',
                    'is_jy': 'N',
                    'is_cj': 'Y', 
                    'encryptedData': '',
                    'whatsSelect': '1',
                    'roomType': '00',
                    'dwAll': 'N',
                    '_json_att': '',
                    'REPEAT_SUBMIT_TOKEN': token
                });
                return request('/otn/confirmPassenger/confirmSingleForQueue', { method: 'POST', body: body });
            },
            setQueryUrl(url) { QUERY_URL = url; }
        };
    })();

    // ==========================================
    // 2. TicketLogicModule (车票解析)
    // ==========================================
    const TicketLogicModule = (() => {
        const SEAT_INDEX_MAP = {
            '商务座': 32, '一等座': 31, '二等座': 30, '特等座': 32,
            '软卧': 23, '硬卧': 28, '硬座': 29, '无座': 26
        };

        function parseTrainInfo(rawString) {
            if (!rawString) return null;
            const parts = rawString.split('|');
            if (parts.length < 30) return null;

            return {
                secretStr: parts[0],
                status: parts[1],
                trainNo: parts[2],
                trainCode: parts[3],
                fromStation: parts[6],
                toStation: parts[7],
                startTime: parts[8],
                endTime: parts[9],
                duration: parts[10],
                canBuy: parts[11],
                leftTicket: parts[12],
                trainDate: parts[13],
                trainLocation: parts[15],
                tickets: {
                    '商务座': parts[32] || '', '一等座': parts[31] || '', '二等座': parts[30] || '',
                    '软卧': parts[23] || '', '硬卧': parts[28] || '', '硬座': parts[29] || '', '无座': parts[26] || ''
                },
                raw: rawString
            };
        }

        function hasTicket(stockStr) {
            if (!stockStr) return false;
            if (stockStr === '有') return true;
            if (stockStr === '无') return false;
            const num = parseInt(stockStr, 10);
            return !isNaN(num) && num > 0;
        }

        return {
            findTargetTrain(resultList, targetTrainCode, targetSeats = ['二等座']) {
                if (!resultList || !Array.isArray(resultList)) return null;
                for (const rawStr of resultList) {
                    const info = parseTrainInfo(rawStr);
                    if (!info) continue;
                    if (info.trainCode.toUpperCase() === targetTrainCode.toUpperCase()) {
                        if (info.canBuy !== 'Y') continue;
                        for (const seatName of targetSeats) {
                            const stock = info.tickets[seatName];
                            if (hasTicket(stock)) {
                                return {
                                    secretStr: info.secretStr,
                                    trainDate: info.trainDate,
                                    trainNo: info.trainNo,
                                    trainCode: info.trainCode,
                                    fromStation: info.fromStation,
                                    toStation: info.toStation,
                                    seatName: seatName,
                                    leftTicket: info.leftTicket,
                                    trainLocation: info.trainLocation
                                };
                            }
                        }
                    }
                }
                return null;
            },
            _parseTrainInfo: parseTrainInfo
        };
    })();

    // ==========================================
    // 3. OrderLogicModule (下单逻辑)
    // ==========================================
    const OrderLogicModule = (() => {
        const REGEX_TOKEN = /globalRepeatSubmitToken\s*=\s*'(\w+)'/;
        const REGEX_KEY_CHECK = /key_check_isChange\s*=\s*'(\w+)'/;
        const REGEX_KEY_CHECK_FALLBACK = /'key_check_isChange':'(\w+)'/;
        const REGEX_LEFT_TICKET = /'leftTicketStr'\s*:\s*'([^']+)'/;

        const SEAT_TYPE_CODE = {
            '商务座': '9', '特等座': 'P', '一等座': 'M', '二等座': 'O',
            '高级软卧': '6', '软卧': '4', '硬卧': '3', '硬座': '1', '无座': '1'
        };

        const TICKET_TYPE_CODE = { '成人': '1', '儿童': '2', '学生': '3', '残军': '4' };

        function buildPassengerStrings(passengers, seatCode) {
            let passengerTicketList = [];
            let oldPassengerList = [];
            passengers.forEach(p => {
                let ticketType = p.passenger_type || TICKET_TYPE_CODE[p.passenger_type_name] || '1';
                const allEncStr = p.allEncStr || '';
                const pStr = `${seatCode},0,${ticketType},${p.passenger_name},${p.passenger_id_type_code},${p.passenger_id_no},${p.mobile_no || ''},N,${allEncStr}`;
                passengerTicketList.push(pStr);
                const oldStr = `${p.passenger_name},${p.passenger_id_type_code},${p.passenger_id_no},${ticketType}_`;
                oldPassengerList.push(oldStr);
            });
            return {
                passengerTicketStr: passengerTicketList.join('_'), 
                oldPassengerStr: oldPassengerList.join('') 
            };
        }

        return {
            async executeOrderSequence(trainInfo, passengers) {
                console.log(`[OrderLogic] Starting order sequence for ${trainInfo.trainCode}`);
                try {
                    console.log('[OrderLogic] Step 1: Submitting order request...');
                    const submitRes = await NetworkModule.submitOrderRequest(
                        trainInfo.secretStr,
                        trainInfo.trainDate,
                        trainInfo.trainDate,
                        trainInfo.fromStation,
                        trainInfo.toStation
                    );
                    if (submitRes.status && !submitRes.status) {
                        throw new Error(`Submit failed: ${submitRes.messages ? submitRes.messages.join(',') : 'Unknown error'}`);
                    }
                    console.log('[OrderLogic] Step 1 Success');

                    console.log('[OrderLogic] Step 2: Getting token...');
                    const htmlContent = await NetworkModule.getInitDcPage();
                    const tokenMatch = htmlContent.match(REGEX_TOKEN);
                    let keyMatch = htmlContent.match(REGEX_KEY_CHECK);
                    if (!keyMatch) keyMatch = htmlContent.match(REGEX_KEY_CHECK_FALLBACK);
                    const leftTicketMatch = htmlContent.match(REGEX_LEFT_TICKET);

                    if (!tokenMatch || !keyMatch) throw new Error('Failed to parse Token or KeyCheck.');
                    if (!leftTicketMatch) throw new Error('Failed to parse leftTicketStr.');

                    const token = tokenMatch[1];
                    const keyCheckIsChange = keyMatch[1];
                    const leftTicketStr = leftTicketMatch[1];
                    console.log(`[OrderLogic] Token: ${token}, Key: ${keyCheckIsChange}, LeftTicket: ${leftTicketStr}`);

                    const seatCode = SEAT_TYPE_CODE[trainInfo.seatName] || 'O';
                    const { passengerTicketStr, oldPassengerStr } = buildPassengerStrings(passengers, seatCode);

                    console.log('[OrderLogic] Step 3: Checking order info...');
                    const checkRes = await NetworkModule.checkOrderInfo(passengerTicketStr, oldPassengerStr, 'dc', token);
                    if (!checkRes.data || !checkRes.data.submitStatus) {
                         throw new Error(`CheckOrderInfo failed: ${checkRes.data ? checkRes.data.errMsg : 'Unknown'}`);
                    }
                    console.log('[OrderLogic] Step 3 Success');

                    console.log('[OrderLogic] Step 4: Getting queue count...');
                    const dateStr = trainInfo.trainDate;
                    const y = dateStr.substring(0, 4), m = dateStr.substring(4, 6), d = dateStr.substring(6, 8);
                    const dateObj = new Date(`${y}-${m}-${d}`);
                    const queueRes = await NetworkModule.getQueueCount(
                        dateObj, trainInfo.trainNo, trainInfo.trainCode, seatCode,
                        trainInfo.fromStation, trainInfo.toStation, token
                    );
                    console.log(`[OrderLogic] Queue info: count=${queueRes.data.countT}, ticket=${queueRes.data.ticket}`);
                    
                    console.log('[OrderLogic] Step 5: Confirming order...');
                    const confirmRes = await NetworkModule.confirmSingleForQueue(
                        passengerTicketStr, oldPassengerStr, keyCheckIsChange, token, leftTicketStr, trainInfo.trainLocation
                    );

                    if (confirmRes.data && confirmRes.data.submitStatus) {
                        console.log('🎉 [OrderLogic] ORDER SUBMITTED SUCCESSFULLY!');
                        return { success: true };
                    } else {
                        throw new Error(`Confirm failed: ${confirmRes.data ? confirmRes.data.errMsg : 'Unknown'}`);
                    }
                } catch (error) {
                    console.error('[OrderLogic] Order Sequence Failed:', error);
                    return { success: false, error: error.message };
                }
            },
            _buildPassengerStrings: buildPassengerStrings
        };
    })();

    // ==========================================
    // 4. UIModule (用户界面)
    // ==========================================
    const UIModule = (() => {
        const STYLES = `
            #ticket-helper-panel {
                position: fixed; top: 50px; right: 20px; width: 320px;
                background: #fff; border: 1px solid #ddd; box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 9999; border-radius: 8px; font-family: sans-serif; font-size: 14px;
            }
            .th-header {
                padding: 10px 15px; background: #3b82f6; color: white;
                border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;
                font-weight: bold; cursor: move;
            }
            .th-body { padding: 15px; max-height: 500px; overflow-y: auto; }
            .th-form-group { margin-bottom: 12px; }
            .th-form-group label { display: block; margin-bottom: 5px; color: #374151; font-weight: 500; }
            .th-input, .th-select { width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; box-sizing: border-box; }
            .th-btn {
                width: 100%; padding: 10px; border: none; border-radius: 4px; color: white; font-weight: bold; cursor: pointer; transition: background 0.2s;
            }
            .th-btn-primary { background: #3b82f6; }
            .th-btn-primary:hover { background: #2563eb; }
            .th-btn-danger { background: #ef4444; }
            .th-btn-danger:hover { background: #dc2626; }
            .th-log-area {
                margin-top: 15px; padding: 10px; background: #f3f4f6; border-radius: 4px; height: 150px; overflow-y: auto; font-family: monospace; font-size: 12px; color: #333; border: 1px solid #e5e7eb;
            }
            .th-log-entry { margin-bottom: 4px; }
            .th-log-info { color: #2563eb; }
            .th-log-success { color: #059669; }
            .th-log-error { color: #dc2626; }
            .th-log-warn { color: #d97706; }
        `;

        let state = {
            isRunning: false,
            config: {
                fromStation: '上海', toStation: '杭州', trainDate: new Date().toISOString().split('T')[0],
                trainCodes: [], seatTypes: [], passengers: []
            },
            passengersList: []
        };
        let logContainer = null, onStartCallback = null, onStopCallback = null;

        function createPanel() {
            const oldPanel = document.getElementById('ticket-helper-panel');
            if (oldPanel) oldPanel.remove();
            const styleEl = document.createElement('style');
            styleEl.textContent = STYLES;
            document.head.appendChild(styleEl);

            const panel = document.createElement('div');
            panel.id = 'ticket-helper-panel';
            panel.innerHTML = `
                <div class="th-header">
                    <span>🚄 12306 抢票助手</span>
                    <span style="font-size:12px; cursor:pointer;" onclick="document.getElementById('ticket-helper-panel').style.display='none'">✕</span>
                </div>
                <div class="th-body">
                    <div class="th-form-group">
                        <label>出发日期</label>
                        <input type="date" class="th-input" id="th-date" value="${state.config.trainDate}">
                    </div>
                    <div class="th-form-group" style="display:flex; gap:10px;">
                        <div style="flex:1"><label>出发站 (中文)</label><input type="text" class="th-input" id="th-from" value="${state.config.fromStation}" placeholder="如 上海"></div>
                        <div style="flex:1"><label>到达站 (中文)</label><input type="text" class="th-input" id="th-to" value="${state.config.toStation}" placeholder="如 杭州"></div>
                    </div>
                    <div class="th-form-group">
                        <label>目标车次 (逗号分隔)</label>
                        <input type="text" class="th-input" id="th-trains" placeholder="如 G123,G456">
                    </div>
                    <div class="th-form-group">
                        <label>席别优先 (逗号分隔)</label>
                        <input type="text" class="th-input" id="th-seats" value="二等座,一等座" placeholder="二等座,一等座">
                    </div>
                    <div class="th-form-group">
                        <label>乘车人 (需先登录)</label>
                        <div id="th-passenger-list" style="max-height:80px; overflow-y:auto; border:1px solid #eee; padding:5px;">
                            <span style="color:#999;">点击刷新加载乘车人...</span>
                        </div>
                        <button id="th-refresh-passengers" style="margin-top:5px; font-size:12px; padding:2px 5px;">刷新乘车人</button>
                    </div>
                    <button id="th-action-btn" class="th-btn th-btn-primary">开始抢票</button>
                    <div class="th-log-area" id="th-logs"><div class="th-log-entry th-log-info">面板已就绪...</div></div>
                </div>
            `;
            document.body.appendChild(panel);
            bindEvents();
            makeDraggable(panel);
            logContainer = document.getElementById('th-logs');
        }

        function bindEvents() {
            document.getElementById('th-action-btn').addEventListener('click', () => {
                state.isRunning ? stop() : start();
            });
            document.getElementById('th-refresh-passengers').addEventListener('click', async () => {
                log('正在获取乘客列表...', 'info');
                try {
                    const res = await NetworkModule.getPassengerDTOs();
                    if (res.data && res.data.normal_passengers) {
                        state.passengersList = res.data.normal_passengers;
                        renderPassengers(state.passengersList);
                        log(`成功获取 ${state.passengersList.length} 位乘客`, 'success');
                    } else { log('未获取到乘客，请确认已登录', 'error'); }
                } catch (e) { log('获取乘客失败: ' + e.message, 'error'); }
            });
        }

        function renderPassengers(list) {
            const container = document.getElementById('th-passenger-list');
            container.innerHTML = '';
            list.forEach(p => {
                const div = document.createElement('div');
                div.innerHTML = `<label style="display:inline-flex; align-items:center; margin-right:10px; font-weight:normal;"><input type="checkbox" value="${p.passenger_name}" data-full='${JSON.stringify(p)}'> ${p.passenger_name}</label>`;
                container.appendChild(div);
            });
        }

        function getConfig() {
            const date = document.getElementById('th-date').value;
            const fromName = document.getElementById('th-from').value.trim();
            const toName = document.getElementById('th-to').value.trim();
            
            // 尝试从 stationMap 获取简码，如果找不到则认为用户输入的就是简码
            const from = stationMap[fromName] || fromName;
            const to = stationMap[toName] || toName;

            const trains = document.getElementById('th-trains').value.split(/[,，]/).map(s => s.trim()).filter(s => s);
            const seats = document.getElementById('th-seats').value.split(/[,，]/).map(s => s.trim()).filter(s => s);
            const selectedPassengers = [];
            document.querySelectorAll('#th-passenger-list input:checked').forEach(checkbox => selectedPassengers.push(JSON.parse(checkbox.dataset.full)));
            return { trainDate: date, fromStation: from, toStation: to, trainCodes: trains, seatTypes: seats, passengers: selectedPassengers };
        }

        function start() {
            const config = getConfig();
            if (config.trainCodes.length === 0) return log('请输入目标车次', 'warn');
            if (config.passengers.length === 0) return log('请选择至少一位乘车人', 'warn');
            state.config = config;
            state.isRunning = true;
            const btn = document.getElementById('th-action-btn');
            btn.textContent = '停止抢票'; btn.className = 'th-btn th-btn-danger';
            log('开始抢票任务...', 'info');
            if (onStartCallback) onStartCallback(config);
        }

        function stop() {
            state.isRunning = false;
            const btn = document.getElementById('th-action-btn');
            btn.textContent = '开始抢票'; btn.className = 'th-btn th-btn-primary';
            log('任务已停止', 'warn');
            if (onStopCallback) onStopCallback();
        }

        function log(msg, type = 'info') {
            if (!logContainer) return;
            const entry = document.createElement('div');
            entry.className = `th-log-entry th-log-${type}`;
            const time = new Date().toLocaleTimeString();
            entry.textContent = `[${time}] ${msg}`;
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight;
        }

        function makeDraggable(element) {
            const header = element.querySelector('.th-header');
            let isDragging = false, startX, startY, initialLeft, initialTop;
            header.addEventListener('mousedown', (e) => {
                isDragging = true; startX = e.clientX; startY = e.clientY;
                const rect = element.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
                element.style.right = 'auto'; element.style.left = initialLeft + 'px'; element.style.top = initialTop + 'px';
            });
            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                element.style.left = (initialLeft + e.clientX - startX) + 'px';
                element.style.top = (initialTop + e.clientY - startY) + 'px';
            });
            document.addEventListener('mouseup', () => isDragging = false);
        }

        return {
            init: (startCb, stopCb) => { createPanel(); onStartCallback = startCb; onStopCallback = stopCb; log('抢票助手 UI 已初始化', 'success'); },
            log: log,
            getIsRunning: () => state.isRunning
        };
    })();

    // ==========================================
    // 5. Main Logic (主控)
    // ==========================================
    let checkInterval = null;
    let isChecking = false;

    async function startTask(config) {
        if (isChecking) return;
        isChecking = true;
        
        const { trainDate, fromStation, toStation, trainCodes, seatTypes, passengers } = config;
        UIModule.log(`目标: ${trainDate} ${fromStation}->${toStation} [${trainCodes.join(',')}]`, 'info');
        
        // 简单校验简码格式 (全大写字母)
        if (!/^[A-Z]+$/.test(fromStation) || !/^[A-Z]+$/.test(toStation)) {
            UIModule.log('警告: 站点似乎未转换为简码，请检查配置或输入简码', 'warn');
        }

        try {
            const loginStatus = await NetworkModule.checkLoginStatus();
            if (!loginStatus) {
                UIModule.log('未登录，请先登录！', 'error');
                isChecking = false;
                return;
            }
        } catch (e) { UIModule.log('检查登录状态失败', 'error'); }

        const doCheck = async () => {
            if (!UIModule.getIsRunning()) {
                clearInterval(checkInterval);
                isChecking = false;
                return;
            }

            try {
                UIModule.log('正在查票...', 'info');
                const queryRes = await NetworkModule.queryTickets(trainDate, fromStation, toStation);
                
                if (!queryRes.status || !queryRes.data.result) {
                    UIModule.log('查票接口返回异常', 'warn');
                    return;
                }

                let targetTrain = null;
                for (const code of trainCodes) {
                    const train = TicketLogicModule.findTargetTrain(queryRes.data.result, code, seatTypes);
                    if (train) { targetTrain = train; break; }
                }

                if (targetTrain) {
                    UIModule.log(`🎉 发现有票: ${targetTrain.trainCode} (${targetTrain.seatName})`, 'success');
                    UIModule.log('正在尝试下单...', 'info');
                    
                    clearInterval(checkInterval);
                    isChecking = false; 

                    const orderResult = await OrderLogicModule.executeOrderSequence(targetTrain, passengers);
                    
                    if (orderResult.success) {
                        UIModule.log('✅ 下单成功！请尽快支付！', 'success');
                        alert('抢票成功！请尽快支付！');
                    } else {
                        UIModule.log(`❌ 下单失败: ${orderResult.error}`, 'error');
                        UIModule.log('3秒后自动重试...', 'warn');
                        setTimeout(() => {
                            if (UIModule.getIsRunning()) {
                                isChecking = false;
                                startTask(config);
                            }
                        }, 3000);
                    }
                } else {
                    // UIModule.log('暂无符合条件的车票', 'info'); 
                }

            } catch (e) {
                UIModule.log(`查票出错: ${e.message}`, 'error');
            }
        };

        doCheck();
        checkInterval = setInterval(doCheck, 2000); // 2秒轮询
    }

    function stopTask() {
        if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
        isChecking = false;
        UIModule.log('已停止刷票', 'warn');
    }

    // 启动 UI
    setTimeout(() => {
        UIModule.init(startTask, stopTask);
        fetchStationMap(); // 启动时自动获取站点简码
    }, 1000);

})();
