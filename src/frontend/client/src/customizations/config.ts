// Centralize BiSheng application IDs here; update an entry when its app is recreated.
// 这些是从dify web-conversation 对应迁移的三个应用
export const CUSTOM_APP_IDS = {
  questionHelper: '99998a8308a94e09bfc5901bb77cc200', // AI 出题助手
  htmlCourseware: '1b2c32648808418fa9665f8022f33e36', // AI 可视化助手
  lessonPlan: '70139d57911e43cb8bc00bea8a35eada', // AI 生成教案
} as const;

export const LESSON_PLAN_EDITOR_PATH = '/adminManage/AiLessonEditor';
