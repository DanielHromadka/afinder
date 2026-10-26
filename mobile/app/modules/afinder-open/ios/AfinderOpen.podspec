Pod::Spec.new do |s|
  s.name           = 'AfinderOpen'
  s.version        = '1.0.0'
  s.summary        = 'Quick Look for aFinder Mobile'
  s.description    = 'Opens downloaded files in Quick Look and reports Markup edits.'
  s.author         = ''
  s.homepage       = 'https://github.com/DanielHromadka/afinder'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'QuickLook'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
end
