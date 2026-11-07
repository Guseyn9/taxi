import React, { useEffect } from 'react'
import { EUserRoles } from '../../types/types'
import { useDispatch } from '../../tools/hooks'
import { setRefCodeModal } from '../../state/modals/actionCreators'
import { ERegistrationType } from '../../state/user/constants'
import ModalStack from './ModalStack'
import { consumeRegistrationCallback } from '../../security/authCallback'

export function ModalHost(_props?: { languageIso?: string }) {
  const dispatch = useDispatch()

  useEffect(() => {
    const callback = consumeRegistrationCallback()
    if (callback)
      dispatch(setRefCodeModal({
        isOpen: true,
        data: {
          u_name: callback.name,
          u_phone: '',
          u_email: callback.email,
          type: ERegistrationType.Email,
          u_role: EUserRoles.Client,
          ref_code: '',
          u_details: {},
          st: '1',
        },
      }))
  }, [])

  return <ModalStack />
}
