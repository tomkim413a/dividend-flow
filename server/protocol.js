/* ============================================================
 * protocol.js —— 前后端共用的消息类型常量
 * （前端通过 <script src="/protocol.js"> 引入，保证类型一致）
 * ============================================================ */

/* 客户端 → 服务端 */
const CS = {
  CREATE_ROOM: 'cs:createRoom',      // 建房 { prof, speed, seatCap, aiCount, visibility }
  JOIN_ROOM:   'cs:joinRoom',        // 加房（{ roomId }）
  LEAVE_ROOM:  'cs:leaveRoom',       // 离房
  START_GAME:  'cs:startGame',       // 房主开局
  SET_PROF:    'cs:setProf',         // 开局前改自己的职业 { prof }
  SET_SPEED:   'cs:setSpeed',        // 调 AI / 动画速度 { speed }（房间级，开局后也生效）
  SET_ROOM_CFG:'cs:setRoomCfg',      // 房主设房间 { seatCap, aiCount, visibility }
  LIST_ROOMS:  'cs:listRooms',       // 拉取公开房列表
  RESUME:      'cs:resume',          // 断线重连回对局 { roomId }
  TOGGLE_AI:   'cs:toggleAi',        // 座位设为 AI / 真人
  ROLL:        'cs:roll',            // 掷骰
  CHOOSE:      'cs:choose',          // 决策（买/不买等）{ choice }
  PAY_DEBT:    'cs:payDebt',         // 还债
  SELL:        'cs:sell'             // 卖股 { sym, shares }
};

/* 服务端 → 客户端 */
const SC = {
  ROOM:        'sc:room',            // 房间信息（成员/状态）
  STATE:       'sc:state',           // 对局状态（权威快照）
  ERROR:       'sc:error',           // 错误提示 { msg }
  GAME_OVER:   'sc:gameOver',        // 对局结束 { winner }
  NOTICE:      'sc:notice',          // 一般通知 { msg }
  ROOM_LIST:   'sc:roomList'         // 公开房列表（只读、脱敏）
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CS, SC };
}
