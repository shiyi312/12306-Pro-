// 12306 UI 交互模块 (UI Module)
// 负责在页面上注入操作面板，收集用户输入，并展示运行日志

const UIModule = (() => {
    
    // 样式定义
    const STYLES = `
        #ticket-helper-panel {
            position: fixed;
            top: 50px;
            right: 20px;
            width: 320px;
            background: #fff;
            border: 1px solid #ddd;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 9999;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
        }
        .th-header {
            padding: 10px 15px;
            background: #3b82f6;
            color: white;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: bold;
            cursor: move;
        }
        .th-body {
            padding: 15px;
            max-height: 500px;
            overflow-y: auto;
        }
        .th-form-group {
            margin-bottom: 12px;
        }
        .th-form-group label {
            display: block;
            margin-bottom: 5px;
            color: #374151;
            font-weight: 500;
        }
        .th-input, .th-select {
            width: 100%;
            padding: 8px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            box-sizing: border-box;
        }
        .th-btn {
            width: 100%;
            padding: 10px;
            border: none;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.2s;
        }
        .th-btn-primary { background: #3b82f6; }
        .th-btn-primary:hover { background: #2563eb; }
        .th-btn-danger { background: #ef4444; }
        .th-btn-danger:hover { background: #dc2626; }
        
        .th-log-area {
            margin-top: 15px;
            padding: 10px;
            background: #f3f4f6;
            border-radius: 4px;
            height: 150px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
            color: #333;
            border: 1px solid #e5e7eb;
        }
        .th-log-entry { margin-bottom: 4px; }
        .th-log-info { color: #2563eb; }
        .th-log-success { color: #059669; }
        .th-log-error { color: #dc2626; }
        .th-log-warn { color: #d97706; }
    `;

    // 状态管理
    let state = {
        isRunning: false,
        config: {
            fromStation: 'SHH', // 默认上海
            toStation: 'HGH',   // 默认杭州
            trainDate: new Date().toISOString().split('T')[0],
            trainCodes: [],     // 用户输入的车次列表
            seatTypes: [],      // 用户选择的席别
            passengers: []      // 用户选择的乘客
        },
        passengersList: [] // 从接口获取的乘客列表缓存
    };

    let logContainer = null;
    let onStartCallback = null;
    let onStopCallback = null;

    // 创建 DOM 元素
    function createPanel() {
        // 移除旧面板
        const oldPanel = document.getElementById('ticket-helper-panel');
        if (oldPanel) oldPanel.remove();

        // 注入样式
        const styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        // 创建面板结构
        const panel = document.createElement('div');
        panel.id = 'ticket-helper-panel';
        panel.innerHTML = `
            <div class="th-header" id="th-header">
                <span>🚄 12306 抢票助手</span>
                <span style="font-size:12px; cursor:pointer;" onclick="document.getElementById('ticket-helper-panel').style.display='none'">✕</span>
            </div>
            <div class="th-body">
                <div class="th-form-group">
                    <label>出发日期</label>
                    <input type="date" class="th-input" id="th-date" value="${state.config.trainDate}">
                </div>
                <div class="th-form-group" style="display:flex; gap:10px;">
                    <div style="flex:1">
                        <label>出发站 (简码)</label>
                        <input type="text" class="th-input" id="th-from" value="${state.config.fromStation}" placeholder="如 SHH">
                    </div>
                    <div style="flex:1">
                        <label>到达站 (简码)</label>
                        <input type="text" class="th-input" id="th-to" value="${state.config.toStation}" placeholder="如 HGH">
                    </div>
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
                
                <div class="th-log-area" id="th-logs">
                    <div class="th-log-entry th-log-info">面板已就绪...</div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // 绑定事件
        bindEvents();
        // 允许拖拽
        makeDraggable(panel);
        
        logContainer = document.getElementById('th-logs');
    }

    function bindEvents() {
        const btn = document.getElementById('th-action-btn');
        btn.addEventListener('click', () => {
            if (state.isRunning) {
                stop();
            } else {
                start();
            }
        });

        document.getElementById('th-refresh-passengers').addEventListener('click', async () => {
            log('正在获取乘客列表...', 'info');
            try {
                // 假设 NetworkModule 已经加载到全局
                if (typeof NetworkModule !== 'undefined') {
                    const res = await NetworkModule.getPassengerDTOs();
                    if (res.data && res.data.normal_passengers) {
                        state.passengersList = res.data.normal_passengers;
                        renderPassengers(state.passengersList);
                        log(`成功获取 ${state.passengersList.length} 位乘客`, 'success');
                    } else {
                        log('未获取到乘客，请确认已登录', 'error');
                    }
                } else {
                    log('NetworkModule 未加载', 'error');
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
            const div = document.createElement('div');
            div.innerHTML = `
                <label style="display:inline-flex; align-items:center; margin-right:10px; font-weight:normal;">
                    <input type="checkbox" value="${p.passenger_name}" data-full='${JSON.stringify(p)}'> ${p.passenger_name}
                </label>
            `;
            container.appendChild(div);
        });
    }

    function getConfig() {
        const date = document.getElementById('th-date').value;
        const from = document.getElementById('th-from').value;
        const to = document.getElementById('th-to').value;
        const trains = document.getElementById('th-trains').value.split(/[,，]/).map(s => s.trim()).filter(s => s);
        const seats = document.getElementById('th-seats').value.split(/[,，]/).map(s => s.trim()).filter(s => s);
        
        // 获取选中乘客
        const selectedPassengers = [];
        document.querySelectorAll('#th-passenger-list input:checked').forEach(checkbox => {
            selectedPassengers.push(JSON.parse(checkbox.dataset.full));
        });

        return {
            trainDate: date,
            fromStation: from,
            toStation: to,
            trainCodes: trains,
            seatTypes: seats,
            passengers: selectedPassengers
        };
    }

    function start() {
        const config = getConfig();
        if (config.trainCodes.length === 0) {
            log('请输入目标车次', 'warn');
            return;
        }
        if (config.passengers.length === 0) {
            log('请选择至少一位乘车人', 'warn');
            return;
        }

        state.config = config;
        state.isRunning = true;
        
        const btn = document.getElementById('th-action-btn');
        btn.textContent = '停止抢票';
        btn.className = 'th-btn th-btn-danger';
        
        log('开始抢票任务...', 'info');
        if (onStartCallback) onStartCallback(config);
    }

    function stop() {
        state.isRunning = false;
        
        const btn = document.getElementById('th-action-btn');
        btn.textContent = '开始抢票';
        btn.className = 'th-btn th-btn-primary';
        
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
        console.log(`[UI] ${msg}`);
    }

    function makeDraggable(element) {
        const header = element.querySelector('.th-header');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            element.style.right = 'auto'; // 清除 right 定位
            element.style.left = initialLeft + 'px';
            element.style.top = initialTop + 'px';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            element.style.left = (initialLeft + dx) + 'px';
            element.style.top = (initialTop + dy) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    return {
        init: (startCb, stopCb) => {
            createPanel();
            onStartCallback = startCb;
            onStopCallback = stopCb;
            log('抢票助手 UI 已初始化', 'success');
        },
        log: log,
        getIsRunning: () => state.isRunning
    };

})();

// 导出 (如果是模块化环境)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIModule;
}