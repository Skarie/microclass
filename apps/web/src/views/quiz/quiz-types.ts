/** 选项卡片的四种视觉状态：未选 / 已选 / 解析正确 / 解析错误 */
export type OptionState = 'idle' | 'selected' | 'correct' | 'wrong';

/** 答题卡语义：练习/考试（未答/已答/标记）与错题本（未做/已看/已掌握） */
export type SheetMode = 'quiz' | 'wrong';
