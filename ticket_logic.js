// 12306 查票逻辑模块 (Ticket Logic Module)
// 负责解析查询结果，匹配用户需求，并做出决策（是否下单）

const TicketLogicModule = (() => {
    
    // 席别代码映射表 (根据 12306 习惯猜测，需根据实际页面数据校准)
    // 对应 result 字符串分割后的索引位置通常是固定的，但也可能变动
    // 参考常见解析逻辑：
    // Index 3: 车次 (G101)
    // Index 0: secretStr (加密串)
    // Index 6: 出发站代码
    // Index 7: 到达站代码
    // Index 8: 出发时间
    // Index 9: 到达时间
    // Index 10: 历时
    // Index 11: 是否可预订 (Y/N/IS_TIME_NOT_BUY)
    // Index 12: leftTicket (用于下单)
    // ... 席别余票索引 ...
    // 32: 商务座/特等座
    // 31: 一等座
    // 30: 二等座
    // 21: 高级软卧
    // 23: 软卧
    // 28: 硬卧
    // 29: 硬座
    // 26: 无座
    
    const SEAT_INDEX_MAP = {
        '商务座': 32,
        '一等座': 31,
        '二等座': 30,
        '特等座': 32, // 有时共用
        '软卧': 23,
        '硬卧': 28,
        '硬座': 29,
        '无座': 26
    };

    /**
     * 解析单条车次数据字符串
     * @param {string} rawString - 12306 返回的 | 分隔字符串
     * @returns {object} 解析后的结构化数据
     */
    function parseTrainInfo(rawString) {
        if (!rawString) return null;
        const parts = rawString.split('|');
        
        // 简单校验长度
        if (parts.length < 30) return null;

        return {
            secretStr: parts[0],        // 下单用的加密串 (注意：需要 decode)
            status: parts[1],           // 状态：预订、列车停运、23:00起售等
            trainNo: parts[2],          // 内部列车号 (240000G10336)
            trainCode: parts[3],        // 车次 (G103)
            fromStation: parts[6],      // 出发站代码
            toStation: parts[7],        // 到达站代码
            startTime: parts[8],        // 出发时间
            endTime: parts[9],          // 到达时间
            duration: parts[10],        // 历时
            canBuy: parts[11],          // Y: 可买, N: 不可买
            leftTicket: parts[12],      // 余票相关字段
            trainDate: parts[13],       // 发车日期 (20241220)
            trainLocation: parts[15],   // 关键参数：train_location (Index 15)
            
            // 余票信息 (解析具体数量: '有', '无', '5', '')
            tickets: {
                '商务座': parts[32] || '',
                '一等座': parts[31] || '',
                '二等座': parts[30] || '',
                '软卧': parts[23] || '',
                '硬卧': parts[28] || '',
                '硬座': parts[29] || '',
                '无座': parts[26] || ''
            },
            
            raw: rawString
        };
    }

    /**
     * 检查余票是否足够
     * @param {string} stockStr - 12306 返回的余票字符 ('有', '无', '10', '')
     * @returns {boolean}
     */
    function hasTicket(stockStr) {
        if (!stockStr) return false;
        if (stockStr === '有') return true;
        if (stockStr === '无') return false;
        const num = parseInt(stockStr, 10);
        return !isNaN(num) && num > 0;
    }

    return {
        /**
         * 从查询结果中查找符合条件的车次
         * @param {Array<string>} resultList - queryTickets 返回的 data.result 数组
         * @param {string} targetTrainCode - 目标车次 (如 'G103')
         * @param {Array<string>} targetSeats - 目标席别列表 (优先级排序，如 ['二等座', '一等座'])
         * @returns {object|null} 匹配成功的车次信息 { secretStr, seatType, trainCode ... }
         */
        findTargetTrain(resultList, targetTrainCode, targetSeats = ['二等座']) {
            if (!resultList || !Array.isArray(resultList)) {
                console.warn('[TicketLogic] Invalid result list');
                return null;
            }

            console.log(`[TicketLogic] Searching for ${targetTrainCode} with seats: ${targetSeats.join(',')}`);

            for (const rawStr of resultList) {
                const info = parseTrainInfo(rawStr);
                if (!info) continue;

                // 1. 匹配车次 (忽略大小写)
                if (info.trainCode.toUpperCase() === targetTrainCode.toUpperCase()) {
                    
                    // 2. 检查是否可预订
                    if (info.canBuy !== 'Y') {
                        console.log(`[TicketLogic] Found ${targetTrainCode} but not buyable (Status: ${info.canBuy})`);
                        continue;
                    }

                    // 3. 按优先级匹配席别
                    for (const seatName of targetSeats) {
                        const stock = info.tickets[seatName];
                        if (hasTicket(stock)) {
                            console.log(`[TicketLogic] ✅ MATCH FOUND! ${targetTrainCode} - ${seatName}: ${stock}`);
                            return {
                                secretStr: info.secretStr, // 原始加密串 (调用 network 时记得 decode)
                                trainDate: info.trainDate, // 格式可能是 20251220
                                trainNo: info.trainNo,
                                trainCode: info.trainCode,
                                fromStation: info.fromStation,
                                toStation: info.toStation,
                                seatName: seatName,
                                leftTicket: info.leftTicket,
                                trainLocation: info.trainLocation // 确保传递
                            };
                        } else {
                            console.log(`[TicketLogic] ${targetTrainCode} - ${seatName}: No tickets (${stock})`);
                        }
                    }
                }
            }

            console.log(`[TicketLogic] No matching tickets found for ${targetTrainCode}`);
            return null;
        },

        // 暴露解析函数用于调试
        _parseTrainInfo: parseTrainInfo
    };
})();

// === 测试代码 ===
function runLogicTests() {
    console.log('>>> 开始 TicketLogic 模块测试 <<<');

    // 模拟数据 (用户提供的样例)
    const mockResult = [
        "bo%2Fm55DrHhmJlbyXvgKRgMu2dei9syPkN%2Bs2FBSR2OOF9csPFnYuhFhAasXVTrxoV4udQDcHLVQD%0A5T1NbD%2FyB1T3irRG5Ai4Scp4w2uiN3Bd0rERE2i9j6ynFyX9N3uUpVjOYUH7Zvd0uMMULTMvVQdU%0AS5w3JRAIYMR8VMAhR4K%2Fv%2FqGWF0B2wo2zuyOcBjGnw7Mm0PUZGe3bJt0fYaAI5Uxh30CtdEyXqKL%0AyDWBKKN%2BkVei9GmoLZIvi0dxbwIHQyn8MkDU%2FSRbL0ztKEDLaZ9CIIfxC1iHEd4D3hoDXH%2BcoIjV%0ArnxvfhYEBYQ70doYsfTQrYezmEWjhHypVDqDVeLuFSJab4a4x7g1SWd3pGs%3D|预订|240000G10336|G103|VNP|AOH|VNP|AOH|06:20|11:58|05:38|Y|h2vul2RYmL2INANtwc3tKJlZO3SQPLl%2FCTP7387PnH4C%2FYgh%2FgSrn9UQvPs%3D|20251220|3|P3|01|09|1|0|||||||无||||有|有|3||90M0O0W0|9MOO|1|0||9187300003M093000021O055300021O055303000|0|||||1|0#1#0#S#z#0#z#z|||CHN,CHN|||N#N#||90081M0088O0084W0084|202512061245|Y|",
        "lKGc8cyW5x2u3ft2VvjSeA%2Bo8Jz%2BrGIGhUMaQl8l1qEjT4iv6hdO9cOEAwj7lWBQsW6Ke6Oql634%0A3%2FG9%2Bl3DsdZOJ3WoJTonV3wi%2Bkuhi1rR4yi3kl43eR2Q6kJWeAJ2MVPKKLjF0Z29bhu4BpxAIiFj%0AYzROgnkKym2c4TKFfSqlLG%2FWdFBuyVrKV1WcAzl5KTYbuxsi42QvbV1aSyWohhfMjjqKcsFSRN92%0A2PyODmgDlig1mA8AnTYa6LwZdVWlcnFjiF31E5snvslxgiY5Se9GfUP5Zgs%2FxwJ6mkY7IcvCpMIO%0AJ5MkhHF7xyJWpS%2FE%2F15Qw59OHSaK5%2FPdrnUSTS9dISYo2FWSSR0OKpYBr%2FA7hbOd|预订|24000000G10K|G1|VNP|SHH|VNP|SHH|07:00|11:29|04:29|Y|hZl9Lec59EEZwmwwEOdO3ijMlCczEm3qn%2Fhd5IzZpxXQrr4UtSdS4qFHnwsePSMUHCdtr0GXN08%3D|20251220|3|P2|01|04|1|0|4||||||无||||有|有|1||90M0O0D0W0|9MODO|0|0||9233700001M107000021O066900021D147100004O066903000|0|||||1|5#1#Q03#0#z#0#z#z|O066900021||CHN,CHN|||N#N#|||202512061245|Y|",
        "F36Tr5yJSdmEM70F0qO%2FT6At8ymURIZ3GLAN14T6%2BiYQqZ5JxRoy2eJ3bJoeV5%2FPTZe5pn2zvMht%0Ag3iXkk%2B8rU2l4UlHbC8GljM701UrGMb%2FNkriNK6QW0ZrajX4yMSuUNvcdP%2BDtO9CbhSJcLGq7LH9%0A8elQs4ODR89xQv3Fb5ohZsod76cao2rl17gWxzAaTmn0hQEhccegi4yQxD4mIc%2FKbINUCUmThAsx%0AQtmSmuaQbBaAiQoPGfGvovWT60FNrUVOKiHc6DPkqYjeoX2bmcBviLqmUyPriPXvK9PKkDmSMkD5%0AjrvVHvG8PpZpvUp%2BsgmJ6IffBf6mDJogz%2FWGf8Ty5nrJbqEhe7%2BCsh5Jmso%3D|预订|240000G1050R|G105|VNP|AOH|VNP|AOH|07:17|13:03|05:46|Y|d%2Fm%2FVPSWJemfjNhwbk9mSTGz8Mc33aoU5Bj5cNMnnIbBincnM5VUl21Csxo%3D|20251220|3|P4|01|09|1|0|||||||无||||有|有|14||90M0O0W0|9MOO|1|0||9199800014M100600021O066200021O066203000|0|||||1|0#1#0#0#z#0#z#z|||CHN,CHN|||N#N#||90087M0095|202512061245|Y|"
    ];

    // 测试 1: 查找 G103 的二等座
    console.log('--- Test 1: Find G103 (二等座) ---');
    const result1 = TicketLogicModule.findTargetTrain(mockResult, 'G103', ['二等座']);
    if (result1 && result1.trainCode === 'G103' && result1.seatName === '二等座') {
        console.log('✅ 成功找到 G103 二等座');
        console.log('SecretStr (Prefix):', result1.secretStr.substring(0, 30) + '...');
    } else {
        console.error('❌ 失败: 未找到 G103');
    }

    // 测试 2: 查找 G1 (一等座有票)
    console.log('--- Test 2: Find G1 (一等座) ---');
    const result2 = TicketLogicModule.findTargetTrain(mockResult, 'G1', ['一等座', '二等座']);
    if (result2 && result2.seatName === '一等座') {
         console.log('✅ 成功找到 G1 一等座 (有票)');
    } else {
         console.error('❌ 失败: 未找到 G1 一等座');
    }

    // 测试 3: 查找 G105 (无票测试，假设 G105 商务座无票)
    // 注意 G105 在样例中 index 32 是 '14' (有票) ? 待检查
    // 让我们看 mock data: G105 商务座(index 32) 是 '无' (index 26) ? 
    // 重新校准 Index: 
    // G105: ...|无||||有|有|14||...
    // 让我们手动 parse 一下看
    const parsedG105 = TicketLogicModule._parseTrainInfo(mockResult[2]);
    console.log('--- Debug G105 ---');
    console.log('商务座:', parsedG105.tickets['商务座']);
    console.log('一等座:', parsedG105.tickets['一等座']);
    console.log('二等座:', parsedG105.tickets['二等座']);

    console.log('>>> 测试结束 <<<');
}

window.TicketLogicModule = TicketLogicModule;
window.runLogicTests = runLogicTests;
