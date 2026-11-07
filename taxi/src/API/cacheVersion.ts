import axios from 'axios'

export const getCacheVersion = (url: string) => axios.get(`${url}/?cv=`, {timeout:10000})
  .then(response => response?.data['cache version'])
