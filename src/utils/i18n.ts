export type AppLang = 'en' | 'ru';

const LANG_KEY = 'sirius_ui_lang';

const STRINGS: Record<AppLang, Record<string, string>> = {
  en: {
    'chat.searchInChat': 'Search in chat',
    'chat.clearChat': 'Clear chat',
    'chat.muteNotif': 'Mute notifications',
    'chat.unmuteNotif': 'Unmute notifications',
    'chat.lockUser': 'Lock user (block messages)',
    'chat.unlockUser': 'Unlock user',
    'chat.groupCall': 'Group voice call',
    'chat.voiceCall': 'Voice call',
    'settings.language': 'Language',
    'settings.langEn': 'English',
    'settings.langRu': 'Russian',
    'settings.design': 'Appearance',
    'settings.title': 'Settings',
    'nav.profile': 'Profile',
    'nav.design': 'Design',
    'nav.notifications': 'Notifications',
    'nav.sound': 'Sound',
    'settings.appearanceLabel': 'Appearance',
    'settings.themeDark': 'Dark',
    'settings.themeLight': 'Light',
    'settings.themeSystem': 'Match system',
    'sticker.title': 'Stickers',
    'nav.advanced': 'Advanced',
    'settings.advancedHint': 'Audio preview, language, and noise processing.',
    'settings.playbackVol': 'Playback volume',
    'settings.noiseReduction': 'Noise reduction',
    'settings.noiseReductionHint': 'Uses browser noise suppression on the microphone.',
    'settings.micMonitor': 'Microphone level',
    'settings.micMonitorHint': 'Live input level from your selected mic (Advanced uses the same device as Sound).',
    'call.screen': 'Screen',
    'call.expel': 'Expel from call',
    'app.searchConversations': 'Search conversations...',
    'friends.search': 'Search...',
    'friends.title': 'Friends',
    'friends.tabFriends': 'Friends',
    'friends.tabRequests': 'Friend Requests',
    'friends.add': 'Add friend',
    'friends.sectionFriends': 'Friends',
    'friends.sectionUsers': 'Users',
    'friends.remove': 'Remove',
    'friends.message': 'Message',
    'friends.incomingRequest': 'Incoming request',
    'friends.requestSent': 'Request sent',
    'friends.sendRequest': 'Send request',
    'friends.none': 'No friends yet.',
    'friends.noUsersMatch': 'No users match your search.',
    'friends.incoming': 'Incoming',
    'friends.outgoing': 'Outgoing',
    'friends.accept': 'Accept',
    'friends.decline': 'Decline',
    'friends.cancel': 'Cancel',
    'friends.noRequests': 'No friend requests.',
    'group.newTitle': 'New group chat',
    'group.name': 'Group name',
    'group.namePlaceholder': 'Team project',
    'group.description': 'Description (optional)',
    'group.descriptionPlaceholder': 'What is this group about?',
    'group.members': 'Members',
    'group.create': 'Create group',
    'group.errName': 'Enter a group name.',
    'group.errMembers': 'Select at least one member.',
    'group.errCreate': 'Could not create group.',
    'friends.errSend': 'Could not send request',
  },
  ru: {
    'chat.searchInChat': 'Поиск в чате',
    'chat.clearChat': 'Очистить чат',
    'chat.muteNotif': 'Отключить уведомления',
    'chat.unmuteNotif': 'Включить уведомления',
    'chat.lockUser': 'Заблокировать пользователя',
    'chat.unlockUser': 'Разблокировать пользователя',
    'chat.groupCall': 'Групповой звонок',
    'chat.voiceCall': 'Голосовой звонок',
    'settings.language': 'Язык',
    'settings.langEn': 'Английский',
    'settings.langRu': 'Русский',
    'settings.design': 'Оформление',
    'settings.title': 'Настройки',
    'nav.profile': 'Профиль',
    'nav.design': 'Оформление',
    'nav.notifications': 'Уведомления',
    'nav.sound': 'Звук',
    'settings.appearanceLabel': 'Тема оформления',
    'settings.themeDark': 'Тёмная',
    'settings.themeLight': 'Светлая',
    'settings.themeSystem': 'Как в системе',
    'sticker.title': 'Стикеры',
    'nav.advanced': 'Дополнительно',
    'settings.advancedHint': 'Уровень микрофона, язык и шумоподавление.',
    'settings.playbackVol': 'Громкость воспроизведения',
    'settings.noiseReduction': 'Шумоподавление',
    'settings.noiseReductionHint': 'Подавление шума в браузере для микрофона.',
    'settings.micMonitor': 'Уровень микрофона',
    'settings.micMonitorHint': 'Уровень сигнала с выбранного микрофона (как в разделе «Звук»).',
    'call.screen': 'Экран',
    'call.expel': 'Исключить из звонка',
    'app.searchConversations': 'Поиск чатов...',
    'friends.search': 'Поиск...',
    'friends.title': 'Друзья',
    'friends.tabFriends': 'Друзья',
    'friends.tabRequests': 'Заявки в друзья',
    'friends.add': 'Добавить друга',
    'friends.sectionFriends': 'Друзья',
    'friends.sectionUsers': 'Пользователи',
    'friends.remove': 'Удалить',
    'friends.message': 'Написать',
    'friends.incomingRequest': 'Входящая заявка',
    'friends.requestSent': 'Заявка отправлена',
    'friends.sendRequest': 'Отправить запрос',
    'friends.none': 'Пока нет друзей.',
    'friends.noUsersMatch': 'Пользователи не найдены.',
    'friends.incoming': 'Входящие',
    'friends.outgoing': 'Исходящие',
    'friends.accept': 'Принять',
    'friends.decline': 'Отклонить',
    'friends.cancel': 'Отменить',
    'friends.noRequests': 'Нет заявок в друзья.',
    'group.newTitle': 'Создание группового чата',
    'group.name': 'Название группы',
    'group.namePlaceholder': 'Команда проекта',
    'group.description': 'Описание (необязательно)',
    'group.descriptionPlaceholder': 'О чём эта группа?',
    'group.members': 'Участники',
    'group.create': 'Создать группу',
    'group.errName': 'Введите название группы.',
    'group.errMembers': 'Выберите хотя бы одного участника.',
    'group.errCreate': 'Не удалось создать группу.',
    'friends.errSend': 'Не удалось отправить запрос',
  },
};

export function getStoredLang(): AppLang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function setStoredLang(lang: AppLang) {
  localStorage.setItem(LANG_KEY, lang);
}

export function t(key: string): string {
  const lang = getStoredLang();
  return STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
}

export function membersLabel(count: number): string {
  const lang = getStoredLang();
  if (lang !== 'ru') {
    return `${count} members`;
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} участник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} участника`;
  return `${count} участников`;
}
