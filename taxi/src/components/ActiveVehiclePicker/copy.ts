import {serviceText} from '../../design/serviceText'
const copy={
 ru:{vehicle:'Автомобиль',choose:'Выберите автомобиль',activate:'Использовать автомобиль',refresh:'Обновить',unknown:'Вместимость машины не указана. Новые заказы недоступны до её проверки.',unconfirmed:'Смена машины не подтверждена. Обновите список и проверьте активный автомобиль.'},
 en:{vehicle:'Vehicle',choose:'Choose a vehicle',activate:'Use this vehicle',refresh:'Refresh',unknown:'Vehicle capacity is missing. New orders are unavailable until it is verified.',unconfirmed:'Vehicle not confirmed. Refresh the list and check the active vehicle.'},
 fr:{vehicle:'Véhicule',choose:'Choisir un véhicule',activate:'Utiliser ce véhicule',refresh:'Actualiser',unknown:'La capacité du véhicule est inconnue. Vérifiez-la avant de recevoir des commandes.',unconfirmed:'Le changement de véhicule est non confirmé. Actualisez la liste et vérifiez le véhicule actif.'},
 ar:{vehicle:'السيارة',choose:'اختر سيارة',activate:'استخدم هذه السيارة',refresh:'تحديث',unknown:'سعة السيارة غير محددة. تحقق منها قبل استقبال الطلبات.',unconfirmed:'لم يتم تأكيد تغيير السيارة. حدّث القائمة وتحقق من السيارة النشطة.'}
}
export function vehiclePickerCopy(iso?:string){const lang=(iso||'en').toLowerCase().split('-')[0] as keyof typeof copy;return serviceText(copy[lang]||copy.en,'driver_vehicle_picker')}
