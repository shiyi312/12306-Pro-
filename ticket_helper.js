// ==UserScript==
// @name         12306 抢票助手 Pro (优化版)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  自动查票、下单，成功后自动跳转支付页
// @author       kl2 (optimized)
// @match        https://kyfw.12306.cn/otn/*
// @grant        GM_notification
// @grant        window.focus
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    console.log('>>> 12306 抢票助手 Pro (优化版) 已加载 <<<');

    // ==========================================
    // 0. Configuration
    // ==========================================
    let stationMap = {};

    async function fetchStationMap() {
        try {
            console.log('正在获取站点简码表...');
            const response = await fetch('https://kyfw.12306.cn/otn/resources/js/framework/station_name.js');
            const text = await response.text();
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
                console.log(`站点简码表加载完成，共 ${Object.keys(stationMap).length} 个站点`);
                UIModule.log('站点简码表加载完成', 'success');
            }
        } catch (e) {
            console.error('获取站点简码表失败:', e);
            UIModule.log('获取站点简码表失败，请检查网络', 'error');
        }
    }

    // ==========================================
    // 1. NetworkModule
    // ==========================================
    const NetworkModule = (() => {
        const BASE_URL = 'https://kyfw.12306.cn';
        const QUERY_URL = '/otn/leftTicket/query';

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
                const response = await fetch(`${BASE_URL}/otn/confirmPassenger/initDc`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: '_json_att='
                });
                return await response.text();
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
                    'leftTicketStr': leftTicketStr,
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
            }
        };
    })();

    // ==========================================
    // 2. TicketLogicModule
    // ==========================================
    const TicketLogicModule = (() => {
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
            }
        };
    })();

    // ==========================================
    // 3. OrderLogicModule
    // ==========================================
    const OrderLogicModule = (() => {
        const REGEX_TOKEN = /globalRepeatSubmitToken\s*=\s*'(\w+)'/;
        const REGEX_KEY_CHECK = /'key_check_isChange':'(\w+)'/;
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
                // 修复学生票判断：严格对比字符串 '3'
                const isStudent = String(p.passenger_type) === '3' || p.passenger_type_name === '学生';
                const ticketType = isStudent ? (p.isStudentTicket ? '3' : '1')
                                               : (p.passenger_type || TICKET_TYPE_CODE[p.passenger_type_name] || '1');
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
                console.log(`[OrderLogic] Starting order for ${trainInfo.trainCode}`);
                try {
                    const submitRes = await NetworkModule.submitOrderRequest(
                        trainInfo.secretStr, trainInfo.trainDate, trainInfo.trainDate,
                        trainInfo.fromStation, trainInfo.toStation
                    );
                    if (submitRes.status === false) {
                        throw new Error(`Submit failed: ${submitRes.messages?.join(',') || 'Unknown error'}`);
                    }

                    const htmlContent = await NetworkModule.getInitDcPage();
                    const tokenMatch = htmlContent.match(REGEX_TOKEN);
                    const keyMatch = htmlContent.match(REGEX_KEY_CHECK);
                    const leftTicketMatch = htmlContent.match(REGEX_LEFT_TICKET);

                    if (!tokenMatch || !keyMatch || !leftTicketMatch) {
                        throw new Error('Failed to parse Token/Key/LeftTicket');
                    }

                    const token = tokenMatch[1];
                    const keyCheckIsChange = keyMatch[1];
                    const leftTicketStr = leftTicketMatch[1];

                    const seatCode = SEAT_TYPE_CODE[trainInfo.seatName] || 'O';
                    const { passengerTicketStr, oldPassengerStr } = buildPassengerStrings(passengers, seatCode);

                    const checkRes = await NetworkModule.checkOrderInfo(passengerTicketStr, oldPassengerStr, 'dc', token);
                    if (!checkRes.data || !checkRes.data.submitStatus) {
                        throw new Error(`CheckOrderInfo failed: ${checkRes.data?.errMsg || 'Unknown'}`);
                    }

                    const dateStr = trainInfo.trainDate;
                    const y = dateStr.substring(0,4), m = dateStr.substring(4,6), d = dateStr.substring(6,8);
                    const dateObj = new Date(`${y}-${m}-${d}`);
                    const queueRes = await NetworkModule.getQueueCount(
                        dateObj, trainInfo.trainNo, trainInfo.trainCode, seatCode,
                        trainInfo.fromStation, trainInfo.toStation, token
                    );
                    console.log(`[OrderLogic] Queue count: ${queueRes.data?.countT}`);

                    const confirmRes = await NetworkModule.confirmSingleForQueue(
                        passengerTicketStr, oldPassengerStr, keyCheckIsChange, token, leftTicketStr, trainInfo.trainLocation
                    );

                    if (confirmRes.data && confirmRes.data.submitStatus) {
                        console.log('🎉 ORDER SUBMITTED SUCCESSFULLY!');
                        // 提取订单号（返回字段可能为 orderId 或 order_id）
                        const orderId = confirmRes.data.orderId || confirmRes.data.order_id || '';
                        return { success: true, orderId: orderId };
                    } else {
                        throw new Error(`Confirm failed: ${confirmRes.data?.errMsg || 'Unknown'}`);
                    }
                } catch (error) {
                    console.error('[OrderLogic] Sequence Failed:', error);
                    return { success: false, error: error.message };
                }
            },
            REGEX_TOKEN,
            REGEX_KEY_CHECK,
            REGEX_LEFT_TICKET
        };
    })();

    // ==========================================
    // 4. UIModule
    // ==========================================
    const UIModule = (() => {
        const STYLES = `
            #ticket-helper-panel { position:fixed; top:50px; right:20px; width:330px; background:#fff; border:1px solid #ddd; box-shadow:0 2px 10px rgba(0,0,0,0.1); z-index:9999; border-radius:8px; font-family:sans-serif; font-size:14px; }
            .th-header { padding:10px 15px; background:#3b82f6; color:white; border-radius:8px 8px 0 0; display:flex; justify-content:space-between; align-items:center; font-weight:bold; cursor:move; }
            .th-body { padding:15px; max-height:500px; overflow-y:auto; }
            .th-form-group { margin-bottom:12px; }
            .th-form-group label { display:block; margin-bottom:5px; color:#374151; font-weight:500; }
            .th-input, .th-select { width:100%; padding:8px; border:1px solid #d1d5db; border-radius:4px; box-sizing:border-box; }
            .th-btn { width:100%; padding:10px; border:none; border-radius:4px; color:white; font-weight:bold; cursor:pointer; transition:background 0.2s; }
            .th-btn-primary { background:#3b82f6; } .th-btn-primary:hover { background:#2563eb; }
            .th-btn-danger { background:#ef4444; } .th-btn-danger:hover { background:#dc2626; }
            .th-log-area { margin-top:15px; padding:10px; background:#f3f4f6; border-radius:4px; height:150px; overflow-y:auto; font-family:monospace; font-size:12px; color:#333; border:1px solid #e5e7eb; }
            .th-log-entry { margin-bottom:4px; }
            .th-log-info { color:#2563eb; } .th-log-success { color:#059669; } .th-log-error { color:#dc2626; } .th-log-warn { color:#d97706; }
        `;

        let state = {
            isRunning: false,
            config: {
                fromStation: '上海', toStation: '杭州', trainDate: new Date().toISOString().split('T')[0],
                trainCodes: [], seatTypes: [], passengers: []
            },
            passengersList: [],
            notificationEnabled: false
        };
        let logContainer = null, onStartCallback = null, onStopCallback = null;

        // 声音提示 (使用 Web Audio 生成蜂鸣)
        function playBeep() {
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.frequency.value = 800;
                oscillator.type = 'square';
                gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
                oscillator.start(audioCtx.currentTime);
                oscillator.stop(audioCtx.currentTime + 0.5);
            } catch(e) { console.log('声音播放失败:', e); }
        }

        function showNotification(title, body) {
            if (Notification.permission === 'granted') {
                new Notification(title, { body, icon: 'https://kyfw.12306.cn/favicon.ico' });
            } else if (Notification.permission === 'default') {
                Notification.requestPermission().then(perm => {
                    if (perm === 'granted') new Notification(title, { body });
                });
            }
            // 无论如何都播放声音
            playBeep();
        }

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
                    <div class="th-form-group">
                        <label>定时抢票 (可选)</label>
                        <input type="time" class="th-input" id="th-start-time" step="1">
                    </div>
                    <div class="th-form-group" style="display:flex; gap:10px;">
                        <div style="flex:1"><label>出发站</label><input type="text" class="th-input" id="th-from" value="${state.config.fromStation}" placeholder="上海"></div>
                        <div style="flex:1"><label>到达站</label><input type="text" class="th-input" id="th-to" value="${state.config.toStation}" placeholder="杭州"></div>
                    </div>
                    <div class="th-form-group">
                        <label>目标车次 (逗号分隔)</label>
                        <input type="text" class="th-input" id="th-trains" placeholder="G123,G456">
                    </div>
                    <div class="th-form-group">
                        <label>席别优先</label>
                        <input type="text" class="th-input" id="th-seats" value="二等座,一等座">
                    </div>
                    <div class="th-form-group">
                        <label>乘车人</label>
                        <div id="th-passenger-list" style="max-height:80px; overflow-y:auto; border:1px solid #eee; padding:5px;"></div>
                        <button id="th-refresh-passengers" style="margin-top:5px; font-size:12px;">刷新乘车人</button>
                    </div>
                    <button id="th-action-btn" class="th-btn th-btn-primary">开始抢票</button>
                    <div class="th-log-area" id="th-logs"><div class="th-log-entry th-log-info">面板就绪，请先加载乘车人</div></div>
                    <div style="font-size:12px; color:#666; margin-top:8px;">💡 抢票成功后将自动跳转支付页，不做实际支付</div>
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
                        log(`已加载 ${state.passengersList.length} 位乘客`, 'success');
                    } else {
                        log('未获取到乘客，请确认已登录', 'error');
                    }
                } catch (e) {
                    log('获取乘客失败: ' + e.message, 'error');
                }
            });
        }

        function renderPassengers(list) {
            const container = document.getElementById('th-passenger-list');
            container.innerHTML = '';
            list.forEach(p => {
                const isStudent = String(p.passenger_type) === '3' || p.passenger_type_name === '学生';
                const div = document.createElement('div');
                div.style.marginBottom = '4px';
                let html = `<label style="display:inline-flex; align-items:center; margin-right:10px; font-weight:normal;">
                    <input type="checkbox" class="th-p-check" value="${p.passenger_name}" data-full='${JSON.stringify(p)}'> ${p.passenger_name}
                </label>`;
                if (isStudent) {
                    html += `<label style="display:inline-flex; align-items:center; font-size:12px; color:#666;">
                        <input type="checkbox" class="th-p-student-check"> 学生票
                    </label>`;
                }
                div.innerHTML = html;
                container.appendChild(div);
            });
        }

        function getConfig() {
            const date = document.getElementById('th-date').value;
            const fromName = document.getElementById('th-from').value.trim();
            const toName = document.getElementById('th-to').value.trim();

            // 加强站点简码校验：若 stationMap 为空或无法解析，提示并抛出
            if (Object.keys(stationMap).length === 0) {
                log('站点简码未加载，请刷新页面重试', 'error');
                throw new Error('站点简码未加载');
            }
            const from = stationMap[fromName] || ( /^[A-Z]+$/.test(fromName) ? fromName : null );
            const to = stationMap[toName] || ( /^[A-Z]+$/.test(toName) ? toName : null );
            if (!from || !to) {
                log(`站点简码转换失败: ${fromName}/${toName}，请使用中文站名或确认网络`, 'error');
                throw new Error('站点简码无效');
            }

            const trains = document.getElementById('th-trains').value.split(/[,，]/).map(s => s.trim()).filter(s => s);
            const seats = document.getElementById('th-seats').value.split(/[,，]/).map(s => s.trim()).filter(s => s);
            const startTime = document.getElementById('th-start-time').value;

            const selectedPassengers = [];
            document.querySelectorAll('#th-passenger-list .th-p-check:checked').forEach(checkbox => {
                const passengerData = JSON.parse(checkbox.dataset.full);
                const parentDiv = checkbox.closest('div');
                const studentCheck = parentDiv.querySelector('.th-p-student-check');
                if (studentCheck && studentCheck.checked) {
                    passengerData.isStudentTicket = true;
                }
                selectedPassengers.push(passengerData);
            });
            return { trainDate: date, fromStation: from, toStation: to, trainCodes: trains, seatTypes: seats, passengers: selectedPassengers, startTime };
        }

        function start() {
            try {
                const config = getConfig();
                if (config.trainCodes.length === 0) return log('请输入目标车次', 'warn');
                if (config.passengers.length === 0) return log('请选择至少一位乘车人', 'warn');
                state.config = config;
                state.isRunning = true;
                const btn = document.getElementById('th-action-btn');
                btn.textContent = '停止抢票'; btn.className = 'th-btn th-btn-danger';
                log('开始抢票任务...', 'info');
                // 请求通知权限
                if (Notification.permission === 'default') {
                    Notification.requestPermission();
                }
                if (onStartCallback) onStartCallback(config);
            } catch (e) {
                log(`配置错误: ${e.message}`, 'error');
            }
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
            init: (startCb, stopCb) => {
                createPanel();
                onStartCallback = startCb;
                onStopCallback = stopCb;
                log('抢票助手 UI 已初始化', 'success');
            },
            log: log,
            getIsRunning: () => state.isRunning,
            showNotification: showNotification,
            playBeep: playBeep
        };
    })();

    // ==========================================
    // 5. Main Logic
    // ==========================================
    let checkInterval = null;
    let isChecking = false;
    let countdownInterval = null;

    async function keepAliveDelay() {
        return Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
    }

    async function sendKeepAliveRequest(config) {
        const rand = Math.random();
        try {
            if (rand < 0.5) {
                // 查票保活
                await NetworkModule.queryTickets(config.trainDate, config.fromStation, config.toStation);
                console.log('[KeepAlive] Silent query');
            } else {
                // 深度保活：请求下单页初始化
                try {
                    // 不再使用空 secretStr 的 submit，直接 initDc
                    const html = await NetworkModule.getInitDcPage();
                    if (!html || html.length < 500) throw new Error('initDc 异常');
                    console.log('[KeepAlive] initDc OK');
                } catch (e) {
                    console.warn('[KeepAlive] initDc failed, fallback to checkLogin');
                    const logged = await NetworkModule.checkLoginStatus();
                    if (!logged) UIModule.log('⚠️ 保活发现未登录！', 'error');
                }
            }
        } catch (e) {
            console.error('[KeepAlive] Error:', e);
        }
    }

    async function startTask(config) {
        if (isChecking) return;
        const { trainDate, fromStation, toStation, trainCodes, seatTypes, passengers, startTime } = config;

        if (startTime) {
            const now = new Date();
            const [h, m, s] = startTime.split(':').map(Number);
            const targetTime = new Date();
            targetTime.setHours(h, m, s || 0, 0);

            if (targetTime > now) {
                isChecking = true;
                UIModule.log(`定时抢票: ${startTime}，等待中...`, 'info');
                let nextKeepAliveTime = Date.now() + await keepAliveDelay();

                countdownInterval = setInterval(async () => {
                    if (!UIModule.getIsRunning()) {
                        clearInterval(countdownInterval);
                        isChecking = false;
                        return;
                    }
                    const currentNow = new Date();
                    const diff = targetTime - currentNow;
                    if (diff <= 0) {
                        clearInterval(countdownInterval);
                        UIModule.log('⏰ 时间到，开始抢票！', 'success');
                        isChecking = false;
                        executeTask(config);
                    } else {
                        // 距离目标 > 2 分钟才保活
                        if (diff > 120000 && Date.now() >= nextKeepAliveTime) {
                            await sendKeepAliveRequest(config);
                            nextKeepAliveTime = Date.now() + await keepAliveDelay();
                        }
                        if (diff < 10000 || diff % 10000 < 1000) {
                            const hours = Math.floor(diff / 3600000);
                            const minutes = Math.floor((diff % 3600000) / 60000);
                            const seconds = Math.floor((diff % 60000) / 1000);
                            UIModule.log(`倒计时: ${hours}时${minutes}分${seconds}秒`, 'info');
                        }
                    }
                }, 1000);
                return;
            } else {
                UIModule.log('设定时间已过，立即开始', 'warn');
            }
        }
        executeTask(config);
    }

    async function executeTask(config) {
        if (isChecking) return;
        isChecking = true;
        const { trainDate, fromStation, toStation, trainCodes, seatTypes, passengers } = config;
        UIModule.log(`目标: ${trainDate} ${fromStation}→${toStation} [${trainCodes.join(',')}]`, 'info');

        try {
            const logged = await NetworkModule.checkLoginStatus();
            if (!logged) {
                UIModule.log('未登录，请先登录！', 'error');
                isChecking = false;
                return;
            }
        } catch (e) { UIModule.log('检查登录状态异常', 'error'); }

        const doCheck = async () => {
            if (!UIModule.getIsRunning()) {
                clearInterval(checkInterval);
                isChecking = false;
                return;
            }
            try {
                UIModule.log('正在查票...', 'info');
                const queryRes = await NetworkModule.queryTickets(trainDate, fromStation, toStation);
                if (!queryRes.status || !queryRes.data?.result) {
                    UIModule.log('查票接口异常', 'warn');
                    return;
                }

                let targetTrain = null;
                for (const code of trainCodes) {
                    const train = TicketLogicModule.findTargetTrain(queryRes.data.result, code, seatTypes);
                    if (train) { targetTrain = train; break; }
                }

                if (targetTrain) {
                    UIModule.log(`🎉 有票: ${targetTrain.trainCode} ${targetTrain.seatName}`, 'success');
                    clearInterval(checkInterval);
                    isChecking = false;

                    const orderResult = await OrderLogicModule.executeOrderSequence(targetTrain, passengers);
                    if (orderResult.success) {
                        // 成功 — 自动跳转支付页面
                        UIModule.log('✅ 下单成功！即将跳转支付页面...', 'success');
                        UIModule.showNotification('抢票成功', `车次 ${targetTrain.trainCode}，请及时支付`);
                        UIModule.playBeep();
                        
                        // 构造支付页 URL，如有订单号可拼接
                        let payUrl = 'https://kyfw.12306.cn/otn/pay/init';
                        if (orderResult.orderId) {
                            payUrl += `?orderId=${orderResult.orderId}`;
                        }
                        // 延迟 1.5 秒跳转，让用户看到成功提示
                        setTimeout(() => {
                            window.location.href = payUrl;
                        }, 1500);
                    } else {
                        UIModule.log(`❌ 下单失败: ${orderResult.error}`, 'error');
                        if (orderResult.error.includes('验证码') || orderResult.error.includes('captcha')) {
                            UIModule.log('可能需要验证码，暂不支持自动处理，请手动操作', 'warn');
                            isChecking = false;
                            return;
                        }
                        UIModule.log('3秒后自动重试...', 'warn');
                        setTimeout(() => {
                            if (UIModule.getIsRunning()) {
                                isChecking = false;
                                executeTask(config);
                            }
                        }, 3000);
                    }
                }
            } catch (e) {
                UIModule.log(`查票出错: ${e.message}`, 'error');
            }
        };

        doCheck();
        // 随机化轮询间隔 2~3 秒
        const randomInterval = Math.floor(Math.random() * 1000) + 2000;
        checkInterval = setInterval(doCheck, randomInterval);
    }

    function stopTask() {
        if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        isChecking = false;
        UIModule.log('已停止刷票', 'warn');
    }

    setTimeout(() => {
        UIModule.init(startTask, stopTask);
        fetchStationMap();
    }, 1000);
})();
