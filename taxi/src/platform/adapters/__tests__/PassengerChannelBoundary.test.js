import fs from 'fs'
import path from 'path'

const PASSENGER_CHANNEL_FILES = [
  'src/pages/Passenger/index.tsx',
  'src/pages/Passenger/VotingForm.tsx',
  'src/components/PassengerLiveOrder/index.tsx',
]

describe('Passenger Channel boundary', () => {
  it.each(PASSENGER_CHANNEL_FILES)('%s does not import Redux or legacy state directly', relativePath => {
    const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')

    expect(source).not.toMatch(/from ['"]react-redux['"]/)
    expect(source).not.toMatch(/from ['"][^'"]*\/state(?:\/[^'"]*)?['"]/)
  })
})
