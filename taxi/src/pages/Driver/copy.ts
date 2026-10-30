const copy = {
  en: { readyTitle:'Available requests',noActive:'No trip in progress',
    statuses: 'Order statuses', noReady: 'No available requests',
    noReadyHint: 'Requests that match your available seats will appear here.',
    noHistory: 'No trips in your history', noHistoryHint: 'Your past trips will appear here.',
  },
  ru: { readyTitle:'Доступные заказы',noActive:'Сейчас нет поездки',
    statuses: 'Статусы заказов', noReady: 'Нет доступных заказов',
    noReadyHint: 'Здесь появятся заказы с учётом свободных мест в машине.',
    noHistory: 'История поездок пуста', noHistoryHint: 'Здесь появятся ваши прошлые поездки.',
  },
  fr: { readyTitle:'Demandes disponibles',noActive:'Aucun trajet en cours',
    statuses: 'Statuts des demandes', noReady: 'Aucune demande disponible',
    noReadyHint: 'Les demandes adaptées aux places disponibles apparaîtront ici.',
    noHistory: 'Aucun trajet dans l’historique', noHistoryHint: 'Vos trajets passés apparaîtront ici.',
  },
  ar: { readyTitle:'الطلبات المتاحة',noActive:'لا توجد رحلة جارية',
    statuses: 'حالات الطلبات', noReady: 'لا توجد طلبات متاحة',
    noReadyHint: 'ستظهر هنا الطلبات المناسبة للمقاعد المتاحة في سيارتك.',
    noHistory: 'سجل الرحلات فارغ', noHistoryHint: 'ستظهر رحلاتك السابقة هنا.',
  },
}

export function driverCopy(iso?: string) {
  const value = (iso || '').toLowerCase()
  const base = value.split('-')[0]
  return value.includes('arab') ? copy.ar : copy[base as keyof typeof copy] || copy.en
}
