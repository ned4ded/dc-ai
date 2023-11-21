import pandas as pd
import os

dirname = os.path.dirname(__file__)
# filename = os.path.join(dirname, 'data/clicks.csv')
pcbuilder_outdated_data_filename = os.path.join(dirname, 'data/gpu_specs_prices.csv')
pcbuilder_current_data_filename = os.path.join(dirname, '../../parser/data/pcbuilder-gpu-data.json')

#  pd.DataFrame
gpus_outdated_df = pd.read_csv(pcbuilder_outdated_data_filename)
# df.to_csv('data.csv', index=False)
gpus_current_df = pd.read_json(pcbuilder_current_data_filename)

# print(data.head())
# print([f"shop_{i+1}" for i in range(len(df.columns))])
# ['name' 'brand' 'model' 'memory' 'memory_interface' 'length' 'interface'
#  'chipset' 'base_clock' 'clock_speed' 'frame_sync' 'price' 'item_url']
chipset = df.groupby(['chipset']).agg('size')
print(df.groupby('brand').size())
