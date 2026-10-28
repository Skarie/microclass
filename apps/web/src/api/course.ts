/**
 * 课程 / 媒体目录 / 分类的视图模型。
 *
 * 从 `api/types.ts` 拆出：该文件是历史超限文件（技术债只能减不能增），
 * 课程这一组类型相对独立，拆出后其余类型继续在原文件 re-export。
 */
export interface Course {
  id: number;
  name: string;
  description: string;
  sort: number;
  created_at: number;
  category_id: number | null;
  cover: string;
  published: 0 | 1;
  category_name?: string;
  total?: number;
  finished?: number;
  quiz?: number;
  fav?: boolean;
  /** 课程绑定的媒体根目录 id（课程文件夹），未绑定为 null */
  folder_root_id?: string | null;
  /** 媒体根目录下的相对路径（空串表示根目录本身） */
  folder_path?: string | null;
  /** 上次扫描导入时间（秒），未扫描过为 null */
  last_scan_at?: number | null;
}

/** 媒体文件夹（服务器上的视频目录） */
export interface MediaRoot {
  id: string;
  name: string;
  path: string;
  available?: boolean;
  /** 使用该目录的课时数 */
  lessons?: number;
  /** 系统内置目录（站内上传），不可移除 */
  internal?: boolean;
}

export interface Category {
  id: number;
  name: string;
  sort: number;
}
