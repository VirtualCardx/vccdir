import type { Lang } from './types';

const translations = {
  // Site
  'site.title': { zh: 'VCC虚拟卡目录', en: 'VCC Directory' },
  'site.description': { zh: '全球虚拟信用卡平台导航 — 对比费率，发现最佳虚拟卡', en: 'Global Virtual Credit Card Platform Navigator — Compare rates, find the best VCC' },
  'site.subtitle': { zh: '发现全球最佳虚拟信用卡平台', en: 'Discover the Best Virtual Credit Card Platforms' },

  // Navigation
  'nav.home': { zh: '首页', en: 'Home' },
  'nav.admin': { zh: '管理后台', en: 'Admin' },
  'nav.login': { zh: '登录', en: 'Login' },
  'nav.logout': { zh: '退出', en: 'Logout' },
  'nav.language': { zh: 'EN', en: '中文' },

  // Homepage
  'home.hero.title': { zh: '全球虚拟信用卡平台目录', en: 'Global VCC Platform Directory' },
  'home.hero.desc': { zh: '对比各平台费率，发现最适合您的虚拟信用卡', en: 'Compare platform rates and find the best virtual credit card for you' },
  'home.platforms': { zh: '平台列表', en: 'Platforms' },
  'home.all': { zh: '全部', en: 'All' },
  'home.search': { zh: '搜索平台...', en: 'Search platforms...' },
  'home.no_results': { zh: '暂无平台数据', en: 'No platforms found' },
  'home.stats.platforms': { zh: '平台数量', en: 'Platforms' },
  'home.stats.cards': { zh: '卡段数量', en: 'Card BINs' },
  'home.stats.tags': { zh: '标签数量', en: 'Tags' },

  // Provider
  'provider.detail': { zh: '平台详情', en: 'Platform Details' },
  'provider.website': { zh: '官网', en: 'Website' },
  'provider.founded': { zh: '建立日期', en: 'Founded' },
  'provider.apply_method': { zh: '开户途径', en: 'Apply Method' },
  'provider.kyc': { zh: 'KYC要求', en: 'KYC Required' },
  'provider.kyc_yes': { zh: '需要', en: 'Yes' },
  'provider.kyc_no': { zh: '不需要', en: 'No' },
  'provider.region': { zh: '地区', en: 'Region' },
  'provider.description': { zh: '平台描述', en: 'Description' },
  'provider.cards': { zh: '卡段列表', en: 'Card BINs' },
  'provider.cards_count': { zh: '个卡段', en: 'BINs' },
  'provider.view_detail': { zh: '查看详情', en: 'View Details' },
  'provider.back': { zh: '返回首页', en: 'Back to Home' },
  'provider.not_found': { zh: '平台未找到', en: 'Platform not found' },

  // Card
  'card.detail': { zh: '卡段详情', en: 'Card BIN Details' },
  'card.bin': { zh: 'BIN', en: 'BIN' },
  'card.type': { zh: '卡组织', en: 'Card Network' },
  'card.currency': { zh: '币种', en: 'Currency' },
  'card.issuance_fee': { zh: '开卡费', en: 'Issuance Fee' },
  'card.fee_rate': { zh: '手续费率', en: 'Fee Rate' },
  'card.monthly_fee': { zh: '月费', en: 'Monthly Fee' },
  'card.initial_load': { zh: '起充额度', en: 'Min. Load' },
  'card.quota': { zh: '额度限制', en: 'Quota' },
  'card.usage': { zh: '使用场景', en: 'Usage' },
  'card.provider': { zh: '所属平台', en: 'Platform' },
  'card.back_provider': { zh: '返回平台', en: 'Back to Platform' },
  'card.not_found': { zh: '卡段未找到', en: 'Card BIN not found' },

  // Admin
  'admin.title': { zh: '管理后台', en: 'Admin Dashboard' },
  'admin.providers': { zh: '平台管理', en: 'Manage Platforms' },
  'admin.cards': { zh: '卡段管理', en: 'Manage Cards' },
  'admin.add_provider': { zh: '添加平台', en: 'Add Platform' },
  'admin.edit_provider': { zh: '编辑平台', en: 'Edit Platform' },
  'admin.delete_provider': { zh: '删除平台', en: 'Delete Platform' },
  'admin.add_card': { zh: '添加卡段', en: 'Add Card BIN' },
  'admin.edit_card': { zh: '编辑卡段', en: 'Edit Card BIN' },
  'admin.delete_card': { zh: '删除卡段', en: 'Delete Card BIN' },
  'admin.confirm_delete': { zh: '确认删除？', en: 'Confirm delete?' },
  'admin.save': { zh: '保存', en: 'Save' },
  'admin.cancel': { zh: '取消', en: 'Cancel' },
  'admin.actions': { zh: '操作', en: 'Actions' },
  'admin.edit': { zh: '编辑', en: 'Edit' },
  'admin.delete': { zh: '删除', en: 'Delete' },
  'admin.back': { zh: '返回列表', en: 'Back to List' },
  'admin.upload_logo': { zh: '上传Logo', en: 'Upload Logo' },
  'admin.select_provider': { zh: '选择平台', en: 'Select Platform' },
  'admin.manage_tags': { zh: '标签管理', en: 'Manage Tags' },
  'admin.tags': { zh: '标签管理', en: 'Manage Tags' },
  'admin.add_tag': { zh: '添加标签', en: 'Add Tag' },
  'admin.tag_name_zh': { zh: '中文名称', en: 'Chinese Name' },
  'admin.tag_name_en': { zh: '英文名称', en: 'English Name' },
  'admin.tag_category': { zh: '分类', en: 'Category' },
  'admin.tag_category_payment': { zh: '支付', en: 'Payment' },
  'admin.tag_category_compliance': { zh: '合规', en: 'Compliance' },
  'admin.tag_category_feature': { zh: '特性', en: 'Feature' },
  'admin.tag_category_type': { zh: '类型', en: 'Type' },
  'admin.change_password': { zh: '修改密码', en: 'Change Password' },
  'admin.old_password': { zh: '当前密码', en: 'Current Password' },
  'admin.new_password': { zh: '新密码', en: 'New Password' },
  'admin.confirm_password': { zh: '确认新密码', en: 'Confirm New Password' },
  'admin.password_changed': { zh: '密码修改成功', en: 'Password changed successfully' },
  'admin.password_error_old': { zh: '当前密码不正确', en: 'Current password is incorrect' },
  'admin.password_error_mismatch': { zh: '两次输入的新密码不一致', en: 'New passwords do not match' },
  'admin.password_error_short': { zh: '新密码至少需要6个字符', en: 'New password must be at least 6 characters' },

  // Login
  'login.title': { zh: '管理员登录', en: 'Admin Login' },
  'login.username': { zh: '用户名', en: 'Username' },
  'login.password': { zh: '密码', en: 'Password' },
  'login.submit': { zh: '登录', en: 'Sign In' },
  'login.error': { zh: '用户名或密码错误', en: 'Invalid username or password' },

  // Common
  'common.status': { zh: '状态', en: 'Status' },
  'common.active': { zh: '活跃', en: 'Active' },
  'common.inactive': { zh: '停用', en: 'Inactive' },
  'common.free': { zh: '免费', en: 'Free' },
  'common.visit': { zh: '访问', en: 'Visit' },
  'common.na': { zh: '暂无', en: 'N/A' },

  // Footer
  'footer.text': { zh: '虚拟信用卡平台目录 — 信息仅供参考，请自行验证', en: 'VCC Platform Directory — Information for reference only, please verify independently' },
} as const;

type TranslationKey = keyof typeof translations;

export function t(key: string, lang: Lang): string {
  const entry = translations[key as TranslationKey];
  if (!entry) return key;
  return entry[lang] || key;
}

export function getLang(value: string | undefined): Lang {
  if (value === 'en') return 'en';
  return 'zh';
}
